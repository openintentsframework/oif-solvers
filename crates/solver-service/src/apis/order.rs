//! OIF Solver Order API Implementation
//!
//! This module implements the order endpoint for the OIF Solver API, providing
//! order retrieval functionality for cross-chain intents. Users can query the
//! status and details of their submitted orders using the order ID.

use axum::{extract::Path, http::StatusCode, response::Json};
use serde::{Deserialize, Serialize};
use solver_core::SolverEngine;
use solver_types::{
	AssetAmount, DetailedIntentStatus, ErrorResponse, GetOrderResponse, SettlementType,
};
use thiserror::Error;
use tracing::{info, warn};
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
) -> Result<GetOrderResponse, GetOrderError> {
	info!("Retrieving order with ID: {}", id);

	match process_order_request(&id).await {
		Ok(order) => Ok(Json(order)),
		Err(e) => {
			warn!("Order retrieval failed: {}", e);
			let (status_code, error_code) = match e {
				OrderError::NotFound(_) => (StatusCode::NOT_FOUND, "ORDER_NOT_FOUND"),
				OrderError::InvalidId(_) => (StatusCode::BAD_REQUEST, "INVALID_ORDER_ID"),
				OrderError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
			};

			Err((
				status_code,
				Json(ErrorResponse {
					error: error_code.to_string(),
					message: e.to_string(),
					details: None,
					retry_after: None,
				}),
			))
		}
	}
}

/// Processes an order retrieval request.
async fn process_order_request(order_id: &str) -> Result<GetOrderResponse, OrderError> {
	// Validate order ID format
	validate_order_id(order_id)?;

	// TODO: In a real implementation, this would:
	// 1. Query the storage for the order TODO: Implement this
	// 2. Check solver permissions to access the order
	// 3. Return the actual order data with current status

	// For demo purposes, return a mock order
	generate_mock_order(order_id)
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

/// Generates a mock order for demonstration purposes.
fn generate_mock_order(order_id: &str) -> Result<GetOrderResponse, OrderError> {
	// In a real implementation, this would query the actual order from storage
	// For now, we'll create a mock order based on the ID

	let order = GetOrderResponse {
		id: order_id.to_string(),
		status: DetailedIntentStatus::Pending,
		created_at: chrono::Utc::now().timestamp() as u64,
		last_updated: chrono::Utc::now().timestamp() as u64,
		quote_id: Some(Uuid::new_v4().to_string()),
		input_amount: AssetAmount {
			asset: "0xA0b86a33E6441b8Bf22a1F6C4Bc1C6F9B25F1B5E".to_string(),
			amount: alloy_primitives::U256::from(1000000000000000000u64), // 1 ETH
		},
		output_amount: AssetAmount {
			asset: "0xdAC17F958D2ee523a2206206994597C13D831ec7".to_string(),
			amount: alloy_primitives::U256::from(3000000000u64), // 3000 USDT
		},
		settlement_type: SettlementType::Escrow,
		settlement_data: serde_json::json!({
			"settler": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
			"fillDeadline": chrono::Utc::now().timestamp() + 3600,
			"recipient": "0x742d35Cc6634C0532925a3b8D42F3D4C38A5F7F1"
		}),
		execution_details: None,
		error_details: None,
	};

	Ok(order)
}
