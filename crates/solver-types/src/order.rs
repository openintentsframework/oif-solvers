//! Order processing types for the solver system.
//!
//! This module defines types related to validated orders, execution decisions,
//! and fill proofs used throughout the order lifecycle.

use alloy_primitives::U256;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{Address, AssetAmount, SettlementType, TransactionHash};

/// Represents a validated cross-chain order with execution state.
///
/// An order is created from a validated intent and contains all information
/// necessary for execution, settlement, and tracking throughout its lifecycle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
	/// Unique identifier for this order.
	pub id: String,
	/// The standard this order conforms to (e.g., "eip7683").
	pub standard: String,
	/// Timestamp when this order was created.
	pub created_at: u64,
	/// Timestamp when this order was last updated.
	pub updated_at: u64,
	/// Current status of the order.
	pub status: OrderStatus,
	/// Standard-specific order data in JSON format.
	pub data: serde_json::Value,
	/// Quote ID associated with this order.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub quote_id: Option<String>,
	/// Execution parameters when order is ready for execution.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub execution_params: Option<ExecutionParams>,
	/// Transaction hash of the prepare transaction (if applicable).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub prepare_tx_hash: Option<TransactionHash>,
	/// Transaction hash of the fill transaction.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub fill_tx_hash: Option<TransactionHash>,
	/// Transaction hash of the claim transaction.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub claim_tx_hash: Option<TransactionHash>,
	/// Fill proof data when available.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub fill_proof: Option<FillProof>,
	/// Additional metadata for tracking order progress.
	#[serde(default)]
	pub metadata: OrderMetadata,
}

/// Additional metadata for order tracking.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OrderMetadata {
	/// Quote ID associated with this order.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub quote_id: Option<String>,
	/// Timestamp when order was finalized.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub finalized_at: Option<u64>,
	/// Error message if order failed.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error_message: Option<String>,
	/// Number of execution attempts.
	#[serde(default)]
	pub execution_attempts: u32,
	/// Timestamp of last execution attempt.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_attempt_at: Option<u64>,
}

/// Parameters for executing an order.
///
/// Contains gas-related parameters determined by the execution strategy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionParams {
	/// Gas price to use for the transaction.
	pub gas_price: U256,
	/// Optional priority fee for EIP-1559 transactions.
	pub priority_fee: Option<U256>,
}

/// Context information for making execution decisions.
///
/// Provides current market conditions and solver state to execution strategies.
#[derive(Debug, Clone)]
pub struct ExecutionContext {
	/// Current gas price on the network.
	pub gas_price: U256,
	/// Current timestamp.
	pub timestamp: u64,
	/// Solver's balance across different addresses and tokens.
	pub solver_balance: HashMap<Address, U256>,
}

/// Decision made by an execution strategy.
///
/// Determines whether and how an order should be executed.
#[derive(Debug)]
pub enum ExecutionDecision {
	/// Execute the order with the specified parameters.
	Execute(ExecutionParams),
	/// Skip the order with a reason.
	Skip(String),
	/// Defer execution for the specified duration.
	Defer(std::time::Duration),
}

/// Proof that an order has been filled.
///
/// Contains all information needed to claim rewards for filling an order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillProof {
	/// Transaction hash of the fill.
	pub tx_hash: TransactionHash,
	/// Block number where the fill was included.
	pub block_number: u64,
	/// Optional attestation data from an oracle.
	pub attestation_data: Option<Vec<u8>>,
	/// Timestamp when the order was filled.
	pub filled_timestamp: u64,
	/// Address of the oracle that attested to the fill.
	pub oracle_address: String,
}

/// Order response for API endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderResponse {
	/// Unique identifier for this order
	pub id: String,
	/// Current order status
	pub status: OrderStatus,
	/// Timestamp when this order was created
	#[serde(rename = "createdAt")]
	pub created_at: u64,
	/// Timestamp when this order was last updated
	#[serde(rename = "updatedAt")]
	pub updated_at: u64,
	/// Associated quote ID if available
	#[serde(rename = "quoteId")]
	pub quote_id: Option<String>,
	/// Input asset and amount
	#[serde(rename = "inputAmount")]
	pub input_amount: AssetAmount,
	/// Output asset and amount
	#[serde(rename = "outputAmount")]
	pub output_amount: AssetAmount,
	/// Settlement mechanism type
	#[serde(rename = "settlementType")]
	pub settlement_type: SettlementType,
	/// Settlement-specific data
	#[serde(rename = "settlementData")]
	pub settlement_data: serde_json::Value,
	/// Transaction details if order has been executed
	#[serde(rename = "fillTransaction")]
	pub fill_transaction: Option<serde_json::Value>,
}

/// Status of an order in the solver system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderStatus {
	/// Order is pending execution.
	Pending,
	/// Order is currently being executed.
	Executing,
	/// Order has been executed.
	Executed,
	/// Order has been claimed.
	Claimed,
	/// Order is finalized and complete (after some block confirmations).
	Finalized,
	/// Order execution failed.
	Failed,
}
