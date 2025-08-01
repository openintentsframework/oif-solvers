//! OIF Solver Order API Implementation
//!
//! This module implements the order endpoint for the OIF Solver API, providing
//! order retrieval functionality for cross-chain intents. Users can query the
//! status and details of their submitted orders using the order ID.

use axum::extract::Path;
use solver_core::SolverEngine;
use solver_storage;
use solver_types::{
	AssetAmount, DetailedIntentStatus, GetOrderResponse, OrderResponse, SettlementType,
};
use thiserror::Error;
use tracing::info;
use uuid::Uuid;

/// Errors that can occur during order processing.
#[derive(Debug, Error)]
pub enum OrderError {
	#[error("Order not found: {0}")]
	NotFound(String),
	#[error("Invalid order ID format: {0}")]
	InvalidId(String),
	#[error("Internal error: {0}")]
	Internal(String),
}

/// Handles GET /order/{id} requests.
///
/// This endpoint retrieves order details by ID, providing status information
/// and execution details for cross-chain intent orders.
pub async fn get_order_by_id(
	Path(id): Path<String>,
	_solver: &SolverEngine,
) -> Result<GetOrderResponse, OrderError> {
	info!("Retrieving order with ID: {}", id);

	let order = process_order_request(&id, _solver).await?;

	Ok(GetOrderResponse { order })
}

/// Processes an order retrieval request.
async fn process_order_request(
	order_id: &str,
	solver: &SolverEngine,
) -> Result<OrderResponse, OrderError> {
	// Validate order ID format
	validate_order_id(order_id)?;

	// Try to retrieve the order from storage
	match solver
		.storage()
		.retrieve::<solver_types::Order>("orders", order_id)
		.await
	{
		Ok(order) => {
			// Order found in storage, convert to OrderResponse
			convert_order_to_response(order).await
		}
		Err(solver_storage::StorageError::NotFound) => {
			// Order not found in storage
			Err(OrderError::NotFound(format!(
				"Order not found: {}",
				order_id
			)))
		}
		Err(e) => {
			// Other storage error
			Err(OrderError::Internal(format!("Storage error: {}", e)))
		}
	}
}

/// Validates the order ID format.
fn validate_order_id(order_id: &str) -> Result<(), OrderError> {
	// Check if it's a valid UUID format
	if Uuid::parse_str(order_id).is_err() {
		return Err(OrderError::InvalidId(format!(
			"Order ID must be a valid UUID: {}",
			order_id
		)));
	}

	Ok(())
}

/// Converts a storage Order to an API OrderResponse.
async fn convert_order_to_response(
	order: solver_types::Order,
) -> Result<OrderResponse, OrderError> {
	// Extract data from the order's JSON data field
	// This assumes the order.data contains the necessary fields for the API response
	let input_amount = order
		.data
		.get("inputAmount")
		.and_then(|v| serde_json::from_value::<AssetAmount>(v.clone()).ok())
		.unwrap_or_else(|| AssetAmount {
			asset: "0x0000000000000000000000000000000000000000".to_string(),
			amount: alloy_primitives::U256::ZERO,
		});

	let output_amount = order
		.data
		.get("outputAmount")
		.and_then(|v| serde_json::from_value::<AssetAmount>(v.clone()).ok())
		.unwrap_or_else(|| AssetAmount {
			asset: "0x0000000000000000000000000000000000000000".to_string(),
			amount: alloy_primitives::U256::ZERO,
		});

	let settlement_type = order
		.data
		.get("settlementType")
		.and_then(|v| serde_json::from_value::<SettlementType>(v.clone()).ok())
		.unwrap_or(SettlementType::Escrow);

	let settlement_data = order
		.data
		.get("settlementData")
		.cloned()
		.unwrap_or_else(|| serde_json::json!({}));

	// For now, assume all orders are pending unless we have more status tracking
	// In a real implementation, you would query additional storage to determine the actual status
	let status = DetailedIntentStatus::Pending;

	let response = OrderResponse {
		id: order.id,
		status,
		created_at: order.created_at,
		last_updated: chrono::Utc::now().timestamp() as u64,
		quote_id: order
			.data
			.get("quoteId")
			.and_then(|v| v.as_str())
			.map(|s| s.to_string()),
		input_amount,
		output_amount,
		settlement_type,
		settlement_data,
		execution_details: order.data.get("executionDetails").cloned(),
		error_details: order
			.data
			.get("errorDetails")
			.and_then(|v| v.as_str())
			.map(|s| s.to_string()),
	};

	Ok(response)
}
