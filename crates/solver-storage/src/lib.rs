//! Storage module for the OIF solver system.
//!
//! This module provides abstractions for persistent storage of solver data,
//! supporting different backend implementations such as in-memory, file-based,
//! or distributed storage systems.

use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};
use solver_types::{
	ExecutionParams, FillProof, Order, OrderStatus, TransactionHash, TransactionType,
};
use std::time::Duration;
use thiserror::Error;

/// Re-export implementations
pub mod implementations {
	pub mod file;
	pub mod memory;
}

/// Errors that can occur during storage operations.
#[derive(Debug, Error)]
pub enum StorageError {
	/// Error that occurs when a requested item is not found.
	#[error("Not found")]
	NotFound,
	/// Error that occurs during serialization/deserialization.
	#[error("Serialization error: {0}")]
	Serialization(String),
	/// Error that occurs in the storage backend.
	#[error("Backend error: {0}")]
	Backend(String),
}

/// Trait defining the low-level interface for storage backends.
///
/// This trait must be implemented by any storage backend that wants to
/// integrate with the solver system. It provides basic key-value operations
/// with optional TTL support.
#[async_trait]
pub trait StorageInterface: Send + Sync {
	/// Retrieves raw bytes for the given key.
	async fn get_bytes(&self, key: &str) -> Result<Vec<u8>, StorageError>;

	/// Stores raw bytes with optional time-to-live.
	async fn set_bytes(
		&self,
		key: &str,
		value: Vec<u8>,
		ttl: Option<Duration>,
	) -> Result<(), StorageError>;

	/// Deletes the value associated with the given key.
	async fn delete(&self, key: &str) -> Result<(), StorageError>;

	/// Checks if a key exists in storage.
	async fn exists(&self, key: &str) -> Result<bool, StorageError>;
}

/// High-level storage service that provides typed operations.
///
/// The StorageService wraps a low-level storage backend and provides
/// convenient methods for storing and retrieving typed data with
/// automatic serialization/deserialization.
pub struct StorageService {
	/// The underlying storage backend implementation.
	backend: Box<dyn StorageInterface>,
}

impl StorageService {
	/// Creates a new StorageService with the specified backend.
	pub fn new(backend: Box<dyn StorageInterface>) -> Self {
		Self { backend }
	}

	/// Stores a serializable value with optional time-to-live.
	///
	/// The namespace and id are combined to form a unique key.
	/// The data is serialized to JSON before storage.
	pub async fn store_with_ttl<T: Serialize>(
		&self,
		namespace: &str,
		id: &str,
		data: &T,
		ttl: Option<Duration>,
	) -> Result<(), StorageError> {
		let key = format!("{}:{}", namespace, id);
		let bytes =
			serde_json::to_vec(data).map_err(|e| StorageError::Serialization(e.to_string()))?;
		self.backend.set_bytes(&key, bytes, ttl).await
	}

	/// Stores a serializable value without time-to-live.
	///
	/// Convenience method that calls store_with_ttl with None for TTL.
	pub async fn store<T: Serialize>(
		&self,
		namespace: &str,
		id: &str,
		data: &T,
	) -> Result<(), StorageError> {
		let key = format!("{}:{}", namespace, id);
		let bytes =
			serde_json::to_vec(data).map_err(|e| StorageError::Serialization(e.to_string()))?;
		self.backend.set_bytes(&key, bytes, None).await
	}

	/// Retrieves and deserializes a value from storage.
	///
	/// The namespace and id are combined to form the lookup key.
	/// The retrieved bytes are deserialized from JSON.
	pub async fn retrieve<T: DeserializeOwned>(
		&self,
		namespace: &str,
		id: &str,
	) -> Result<T, StorageError> {
		let key = format!("{}:{}", namespace, id);
		let bytes = self.backend.get_bytes(&key).await?;
		serde_json::from_slice(&bytes).map_err(|e| StorageError::Serialization(e.to_string()))
	}

	/// Removes a value from storage.
	///
	/// The namespace and id are combined to form the key to delete.
	pub async fn remove(&self, namespace: &str, id: &str) -> Result<(), StorageError> {
		let key = format!("{}:{}", namespace, id);
		self.backend.delete(&key).await
	}

	/// Updates an existing value in storage.
	///
	/// This method first checks if the key exists, then updates the value.
	/// Returns an error if the key doesn't exist, making it semantically different
	/// from store() which will create or overwrite.
	pub async fn update<T: Serialize>(
		&self,
		namespace: &str,
		id: &str,
		data: &T,
	) -> Result<(), StorageError> {
		let key = format!("{}:{}", namespace, id);

		// Check if the key exists first
		if !self.backend.exists(&key).await? {
			return Err(StorageError::NotFound);
		}

		let bytes =
			serde_json::to_vec(data).map_err(|e| StorageError::Serialization(e.to_string()))?;
		self.backend.set_bytes(&key, bytes, None).await
	}

	/// Updates an existing value in storage with time-to-live.
	///
	/// This method first checks if the key exists, then updates the value with TTL.
	/// Returns an error if the key doesn't exist.
	pub async fn update_with_ttl<T: Serialize>(
		&self,
		namespace: &str,
		id: &str,
		data: &T,
		ttl: Option<Duration>,
	) -> Result<(), StorageError> {
		let key = format!("{}:{}", namespace, id);

		// Check if the key exists first
		if !self.backend.exists(&key).await? {
			return Err(StorageError::NotFound);
		}

		let bytes =
			serde_json::to_vec(data).map_err(|e| StorageError::Serialization(e.to_string()))?;
		self.backend.set_bytes(&key, bytes, ttl).await
	}

	/// Checks if a value exists in storage.
	///
	/// The namespace and id are combined to form the lookup key.
	pub async fn exists(&self, namespace: &str, id: &str) -> Result<bool, StorageError> {
		let key = format!("{}:{}", namespace, id);
		self.backend.exists(&key).await
	}

	/// Updates an Order and automatically sets the updated_at timestamp.
	///
	/// This is a specialized method for updating Order structs that automatically
	/// handles the updated_at field.
	pub async fn update_order(&self, order_id: &str, mut order: Order) -> Result<(), StorageError> {
		use std::time::{SystemTime, UNIX_EPOCH};

		// Automatically set updated_at to current timestamp
		order.updated_at = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map_err(|e| StorageError::Backend(format!("Time error: {}", e)))?
			.as_secs();

		self.update("orders", order_id, &order).await
	}

	/// Updates order status and metadata.
	pub async fn update_order_status(
		&self,
		order_id: &str,
		status: OrderStatus,
	) -> Result<(), StorageError> {
		let mut order: Order = self.retrieve("orders", order_id).await?;
		// Set finalized timestamp if transitioning to Finalized
		if matches!(status, OrderStatus::Finalized) {
			use std::time::{SystemTime, UNIX_EPOCH};
			order.metadata.finalized_at = Some(
				SystemTime::now()
					.duration_since(UNIX_EPOCH)
					.map_err(|e| StorageError::Backend(format!("Time error: {}", e)))?
					.as_secs(),
			);
		}

		order.status = status;
		self.update_order(order_id, order).await
	}

	/// Sets execution parameters for an order.
	pub async fn set_order_execution_params(
		&self,
		order_id: &str,
		params: ExecutionParams,
	) -> Result<(), StorageError> {
		let mut order: Order = self.retrieve("orders", order_id).await?;
		order.execution_params = Some(params);
		order.status = solver_types::OrderStatus::PreparedForExecution;
		self.update_order(order_id, order).await
	}

	/// Updates transaction hash for an order.
	pub async fn set_order_transaction(
		&self,
		order_id: &str,
		tx_type: TransactionType,
		tx_hash: TransactionHash,
	) -> Result<(), StorageError> {
		let mut order: Order = self.retrieve("orders", order_id).await?;
		// TODO: check if we can search by tx_hash instead of order_id!

		match tx_type {
			TransactionType::Prepare => {
				order.prepare_tx_hash = Some(tx_hash);
			}
			TransactionType::Fill => {
				order.fill_tx_hash = Some(tx_hash);
				order.status = OrderStatus::Executed;
			}
			TransactionType::Claim => {
				order.claim_tx_hash = Some(tx_hash);
				order.status = OrderStatus::Finalized;
			}
		}

		self.update_order(order_id, order).await
	}

	/// Sets fill proof for an order.
	pub async fn set_order_fill_proof(
		&self,
		order_id: &str,
		fill_proof: FillProof,
	) -> Result<(), StorageError> {
		let mut order: Order = self.retrieve("orders", order_id).await?;
		order.fill_proof = Some(fill_proof);
		self.update_order(order_id, order).await
	}

	pub async fn set_order_tx_hash(
		&self,
		order_id: &str,
		tx_type: TransactionType,
		tx_hash: TransactionHash,
	) -> Result<(), StorageError> {
		let mut order: Order = self.retrieve("orders", order_id).await?;
		match tx_type {
			TransactionType::Prepare => {
				order.prepare_tx_hash = Some(tx_hash);
			}
			TransactionType::Fill => {
				order.fill_tx_hash = Some(tx_hash);
			}
			TransactionType::Claim => {
				order.claim_tx_hash = Some(tx_hash);
			}
		}
		self.update_order(order_id, order).await
	}

	/// Marks an order as failed with an error message.
	pub async fn fail_order(
		&self,
		order_id: &str,
		error_message: String,
	) -> Result<(), StorageError> {
		let mut order: Order = self.retrieve("orders", order_id).await?;
		order.status = OrderStatus::Failed;
		order.metadata.error_message = Some(error_message);
		self.update_order(order_id, order).await
	}
}
