//! Order processing types for the solver system.
//!
//! This module defines types related to validated orders, execution decisions,
//! and fill proofs used throughout the order lifecycle.

use alloy_primitives::U256;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{Address, AssetAmount, SettlementType, TransactionHash};

/// Represents a validated cross-chain order.
///
/// An order is created from a validated intent and contains all information
/// necessary for execution and settlement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
	/// Unique identifier for this order.
	pub id: String,
	/// The standard this order conforms to (e.g., "eip7683").
	pub standard: String,
	/// Timestamp when this order was created.
	pub created_at: u64,
	/// Standard-specific order data in JSON format.
	pub data: serde_json::Value,
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
	#[serde(rename = "lastUpdated")]
	pub last_updated: u64,
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
	/// Error details if failed
	#[serde(rename = "errorDetails")]
	pub error_details: Option<String>,
}

/// Status of an order in the solver system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderStatus {
	Pending,
	Executed,
	Finalized,
	Failed,
}
