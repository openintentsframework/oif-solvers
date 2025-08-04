//! OIF Solver Order API Implementation
//!
//! This module implements the order endpoint for the OIF Solver API, providing
//! order retrieval functionality for cross-chain intents. Users can query the
//! status and details of their submitted orders using the order ID.

use axum::extract::Path;
use solver_core::SolverEngine;
use solver_storage;
use solver_types::{
	AssetAmount, GetOrderError, GetOrderResponse, OrderResponse, OrderStatus, SettlementType,
};
use tracing::info;
use uuid::Uuid;

/// Handles GET /order/{id} requests.
///
/// This endpoint retrieves order details by ID, providing status information
/// and execution details for cross-chain intent orders.
pub async fn get_order_by_id(
	Path(id): Path<String>,
	_solver: &SolverEngine,
) -> Result<GetOrderResponse, GetOrderError> {
	info!("Retrieving order with ID: {}", id);

	let order = process_order_request(&id, _solver).await?;

	Ok(GetOrderResponse { order })
}

/// Processes an order retrieval request.
async fn process_order_request(
	order_id: &str,
	solver: &SolverEngine,
) -> Result<OrderResponse, GetOrderError> {
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
			Err(GetOrderError::NotFound(format!(
				"Order not found: {}",
				order_id
			)))
		}
		Err(e) => {
			// Other storage error
			Err(GetOrderError::Internal(format!("Storage error: {}", e)))
		}
	}
}

/// Validates the order ID format.
fn validate_order_id(order_id: &str) -> Result<(), GetOrderError> {
	// Check if it's a valid UUID format
	if Uuid::parse_str(order_id).is_err() {
		return Err(GetOrderError::InvalidId(format!(
			"Order ID must be a valid UUID: {}",
			order_id
		)));
	}

	Ok(())
}

/// Converts a storage Order to an API OrderResponse.
async fn convert_order_to_response(
	order: solver_types::Order,
) -> Result<OrderResponse, GetOrderError> {
	// Extract data from the order's JSON data field
	// Return errors instead of defaulting to placeholder values

	let input_amount = order.data.get("inputAmount").ok_or_else(|| {
		GetOrderError::Internal("Missing inputAmount field in order data".to_string())
	})?;
	let input_amount = serde_json::from_value::<AssetAmount>(input_amount.clone())
		.map_err(|e| GetOrderError::Internal(format!("Invalid inputAmount format: {}", e)))?;

	let output_amount = order.data.get("outputAmount").ok_or_else(|| {
		GetOrderError::Internal("Missing outputAmount field in order data".to_string())
	})?;
	let output_amount = serde_json::from_value::<AssetAmount>(output_amount.clone())
		.map_err(|e| GetOrderError::Internal(format!("Invalid outputAmount format: {}", e)))?;

	let settlement_type = order.data.get("settlementType").ok_or_else(|| {
		GetOrderError::Internal("Missing settlementType field in order data".to_string())
	})?;
	let settlement_type = serde_json::from_value::<SettlementType>(settlement_type.clone())
		.map_err(|e| GetOrderError::Internal(format!("Invalid settlementType format: {}", e)))?;

	let settlement_data = order
		.data
		.get("settlementData")
		.cloned()
		.unwrap_or_else(|| serde_json::json!({}));

	let status = order
		.data
		.get("status")
		.and_then(|v| serde_json::from_value::<OrderStatus>(v.clone()).ok())
		.ok_or_else(|| {
			GetOrderError::Internal("Missing or invalid status field in order data".to_string())
		})?;

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
		transaction: order.data.get("transaction").cloned(),
		error_details: order
			.data
			.get("errorDetails")
			.and_then(|v| v.as_str())
			.map(|s| s.to_string()),
	};

	Ok(response)
}
