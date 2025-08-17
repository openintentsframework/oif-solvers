//! Settlement module for the OIF solver system.
//!
//! This module handles the validation of filled orders and manages the claiming
//! process for solver rewards. It supports different settlement mechanisms
//! for various order standards.

use async_trait::async_trait;
use solver_config::Config;
use solver_types::{ConfigSchema, FillProof, Order, TransactionHash};
use alloy_primitives::Address as AlloyAddress;
use std::collections::HashMap;
use thiserror::Error;

/// Re-export implementations
pub mod implementations {
	pub mod direct;
}

/// Errors that can occur during settlement operations.
#[derive(Debug, Error)]
pub enum SettlementError {
	/// Error that occurs when settlement validation fails.
	#[error("Validation failed: {0}")]
	ValidationFailed(String),
	/// Error that occurs when a fill proof is invalid.
	#[error("Invalid proof")]
	InvalidProof,
	/// Error that occurs when a fill doesn't match order requirements.
	#[error("Fill does not match order requirements")]
	FillMismatch,
}

/// Trait defining the interface for settlement mechanisms.
///
/// This trait must be implemented by each settlement mechanism to handle
/// validation of fills and management of the claim process for different
/// order standards.
#[async_trait]
pub trait SettlementInterface: Send + Sync {
	/// Returns the configuration schema for this settlement implementation.
	///
	/// This allows each implementation to define its own configuration requirements
	/// with specific validation rules. The schema is used to validate TOML configuration
	/// before initializing the settlement mechanism.
	fn config_schema(&self) -> Box<dyn ConfigSchema>;

	/// Gets attestation data for a filled order by extracting proof data needed for claiming.
	///
	/// This method should:
	/// 1. Fetch the transaction receipt using the tx_hash
	/// 2. Parse logs/events to extract fill details
	/// 3. Verify the fill satisfies the order requirements
	/// 4. Build a FillProof containing all data needed for claiming
	async fn get_attestation(
		&self,
		order: &Order,
		tx_hash: &TransactionHash,
	) -> Result<FillProof, SettlementError>;

	/// Checks if the solver can claim rewards for this fill.
	///
	/// This method should check on-chain conditions such as:
	/// - Time delays or challenge periods
	/// - Oracle attestations if required
	/// - Solver permissions
	/// - Reward availability
	async fn can_claim(&self, order: &Order, fill_proof: &FillProof) -> bool;
}

/// Service that manages settlement operations with multiple implementations.
///
/// The SettlementService coordinates between different settlement mechanisms
/// based on the order standard, handling fill validation and claim readiness checks.
pub struct SettlementService {
	/// Map of standard names to their settlement implementations.
	implementations: HashMap<String, Box<dyn SettlementInterface>>,
}

impl SettlementService {
	/// Creates a new SettlementService with the specified implementations.
	pub fn new(implementations: HashMap<String, Box<dyn SettlementInterface>>) -> Self {
		Self { implementations }
	}

	/// Gets attestation for a filled order using the appropriate settlement implementation.
	///
	/// Selects the implementation based on the order's standard field
	/// and delegates attestation retrieval to that implementation.
	pub async fn get_attestation(
		&self,
		order: &Order,
		tx_hash: &TransactionHash,
	) -> Result<FillProof, SettlementError> {
		let implementation = self
			.implementations
			.get(&order.standard)
			.ok_or_else(|| SettlementError::ValidationFailed("Unknown standard".into()))?;

		implementation.get_attestation(order, tx_hash).await
	}

	/// Checks if an order can be claimed using the appropriate settlement implementation.
	pub async fn can_claim(&self, order: &Order, fill_proof: &FillProof) -> bool {
		if let Some(implementation) = self.implementations.get(&order.standard) {
			implementation.can_claim(order, fill_proof).await
		} else {
			false
		}
	}
}

/// Resolve the oracle address for a given chain from settlement implementation config.
///
/// This is a generic helper that lives in settlement layer and can be reused
/// by any consumer needing the configured oracle address. It expects the
/// settlement implementation name `eip7683` and looks up
/// `settlement.implementations.eip7683.oracle_addresses` in the provided `Config`.
pub fn resolve_oracle_address(config: &Config, chain_id: u64) -> Result<AlloyAddress, String> {
    let Some(impl_val) = config.settlement.implementations.get("eip7683") else {
        return Err("Missing settlement.implementations.eip7683 in config".to_string());
    };
    let Some(table) = impl_val.as_table() else {
        return Err("Invalid eip7683 settlement implementation format".to_string());
    };
    let Some(oracle_map) = table.get("oracle_addresses").and_then(|v| v.as_table()) else {
        return Err("Missing oracle_addresses in eip7683 settlement implementation".to_string());
    };
    let key = chain_id.to_string();
    let Some(addr_str) = oracle_map.get(&key).and_then(|v| v.as_str()) else {
        return Err(format!("Oracle address not configured for chain {}", chain_id));
    };
    addr_str
        .parse::<AlloyAddress>()
        .map_err(|e| format!("Invalid oracle address: {}", e))
}
