//! Custody decision engine for cross-chain token transfers.
//!
//! This module implements the logic for determining how tokens should be secured
//! during cross-chain transfers. It analyzes token capabilities, user preferences,
//! and protocol availability to select the optimal custody mechanism for each quote.
//!
//! ## Overview
//!
//! The custody module makes intelligent decisions about:
//! - Whether to use resource locks (pre-authorized funds) or escrow mechanisms
//! - Which specific protocol to use (Permit2, ERC-3009, TheCompact, etc.)
//! - How to optimize for gas costs, security, and user experience
//!
//! ## Custody Mechanisms
//!
//! ### Resource Locks
//! Pre-authorized fund allocations that don't require token movement:
//! - **TheCompact**: Advanced resource locking with allocation proofs
//! - **Custom Locks**: Protocol-specific locking mechanisms
//!
//! ### Escrow Mechanisms
//! Traditional token custody through smart contracts:
//! - **Permit2**: Universal approval system with signature-based transfers
//! - **ERC-3009**: Native gasless transfers for supported tokens (USDC, etc.)
//!
//! ## Decision Process
//!
//! 1. **Check for existing locks**: If user has pre-authorized funds, prefer using them
//! 2. **Analyze token capabilities**: Determine which protocols the token supports
//! 3. **Evaluate chain support**: Ensure the protocol is available on the source chain
//! 4. **Optimize selection**: Choose based on gas costs, security, and UX preferences
//!
//! ## Token Analysis
//!
//! The module maintains knowledge about token capabilities:
//! - ERC-3009 support (primarily USDC and similar tokens)
//! - Permit2 availability (universal but requires deployment)
//! - Custom protocol support (token-specific features)

use super::registry::{TokenCapabilities, PROTOCOL_REGISTRY};
use alloy_primitives::hex;
use solver_types::{Address, AvailableInput, LockKind as ApiLockKind, QuoteError};
use std::collections::HashMap;

/// Types of resource locks supported
#[derive(Debug, Clone)]
pub enum LockKind {
	TheCompact { params: serde_json::Value },
}

/// Types of escrow mechanisms
#[derive(Debug, Clone)]
pub enum EscrowKind {
	Permit2,
	Erc3009,
}

/// Custody strategy decision
#[derive(Debug, Clone)]
pub enum CustodyDecision {
	ResourceLock { kind: LockKind },
	Escrow { kind: EscrowKind },
}

/// Custody strategy decision engine
pub struct CustodyStrategy {
	/// Cached token capabilities to avoid repeated lookups
	token_capabilities: HashMap<String, TokenCapabilities>,
	/// Permit2 contract addresses per chain
	permit2_addresses: HashMap<u64, Address>,
}

impl CustodyStrategy {
	pub fn new() -> Self {
		Self {
			token_capabilities: HashMap::new(),
			permit2_addresses: Self::default_permit2_addresses(),
		}
	}

	pub async fn decide_custody(
		&self,
		input: &AvailableInput,
	) -> Result<CustodyDecision, QuoteError> {
		if let Some(lock) = &input.lock {
			return self.handle_resource_lock(lock);
		}
		self.decide_escrow_strategy(input).await
	}

	fn handle_resource_lock(
		&self,
		lock: &solver_types::Lock,
	) -> Result<CustodyDecision, QuoteError> {
		let lock_kind = match lock.kind {
			ApiLockKind::TheCompact => LockKind::TheCompact {
				params: lock.params.clone().unwrap_or_default(),
			},
		};
		Ok(CustodyDecision::ResourceLock { kind: lock_kind })
	}

	async fn decide_escrow_strategy(
		&self,
		input: &AvailableInput,
	) -> Result<CustodyDecision, QuoteError> {
		let chain_id = input.asset.ethereum_chain_id().map_err(|e| {
			QuoteError::InvalidRequest(format!("Invalid chain ID in asset address: {}", e))
		})?;

		let token_address = input
			.asset
			.ethereum_address()
			.map_err(|e| QuoteError::InvalidRequest(format!("Invalid Ethereum address: {}", e)))?;

		let capabilities = PROTOCOL_REGISTRY.get_token_capabilities(chain_id, token_address);

		if capabilities.supports_erc3009 {
			Ok(CustodyDecision::Escrow {
				kind: EscrowKind::Erc3009,
			})
		} else if capabilities.permit2_available {
			Ok(CustodyDecision::Escrow {
				kind: EscrowKind::Permit2,
			})
		} else {
			Err(QuoteError::UnsupportedSettlement(
				"No supported settlement mechanism available for this token".to_string(),
			))
		}
	}

	/// Get token capabilities (with caching)
	async fn get_token_capabilities(
		&self,
		chain_id: u64,
		token_address: Address,
	) -> Result<TokenCapabilities, QuoteError> {
		let cache_key = format!("{}:{:?}", chain_id, token_address);

		if let Some(capabilities) = self.token_capabilities.get(&cache_key) {
			return Ok(capabilities.clone());
		}

		// Detect capabilities
		let capabilities = self
			.detect_token_capabilities(chain_id, token_address)
			.await?;

		// Cache for future use
		// Note: In a real implementation, you'd want a proper cache with TTL
		// self.token_capabilities.insert(cache_key, capabilities.clone());

		Ok(capabilities)
	}

	/// Detect token capabilities on-chain
	async fn detect_token_capabilities(
		&self,
		chain_id: u64,
		_token_address: Address,
	) -> Result<TokenCapabilities, QuoteError> {
		// TODO: Implement actual on-chain detection
		// For now, return conservative defaults

		let permit2_available = self.permit2_addresses.contains_key(&chain_id);

		// TODO: Implement ERC-3009 detection
		let supports_erc3009 = false; // Conservative default

		Ok(TokenCapabilities {
			supports_erc3009,
			permit2_available,
		})
	}

	/// Default Permit2 contract addresses per chain
	pub fn default_permit2_addresses() -> HashMap<u64, Address> {
		let mut addresses = HashMap::new();

		let permit2_hex = "000000000022D473030F116dDEE9F6B43aC78BA3";
		let permit2_bytes = hex::decode(permit2_hex).expect("Valid Permit2 address");

		// Ethereum Mainnet
		addresses.insert(1, Address(permit2_bytes.clone()));
		// Polygon
		addresses.insert(137, Address(permit2_bytes.clone()));
		// Arbitrum
		addresses.insert(42161, Address(permit2_bytes.clone()));
		// Optimism
		addresses.insert(10, Address(permit2_bytes.clone()));
		// Base
		addresses.insert(8453, Address(permit2_bytes.clone()));
		// Local Anvil demo chains
		addresses.insert(31337, Address(permit2_bytes.clone()));
		addresses.insert(31338, Address(permit2_bytes));

		addresses
	}
}

impl Default for CustodyStrategy {
	fn default() -> Self {
		Self::new()
	}
}
