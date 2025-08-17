//! Custody Strategy Decision Logic (moved from solver-service)

use alloy_primitives::Address;
use solver_types::{AvailableInput, LockKind as ApiLockKind, QuoteError};
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

/// Token capabilities for settlement decisions
#[derive(Debug, Clone)]
pub struct TokenCapabilities {
	pub supports_erc3009: bool,
	pub permit2_available: bool,
}

/// Custody strategy decision engine
pub struct CustodyStrategy {
	permit2_addresses: HashMap<u64, Address>,
	token_capabilities: HashMap<String, TokenCapabilities>,
}

impl CustodyStrategy {
	pub fn new() -> Self {
		Self {
			permit2_addresses: Self::default_permit2_addresses(),
			token_capabilities: HashMap::new(),
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
		let capabilities = self.get_token_capabilities(chain_id, token_address).await?;
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

	async fn get_token_capabilities(
		&self,
		chain_id: u64,
		token_address: Address,
	) -> Result<TokenCapabilities, QuoteError> {
		let cache_key = format!("{}:{:?}", chain_id, token_address);
		if let Some(capabilities) = self.token_capabilities.get(&cache_key) {
			return Ok(capabilities.clone());
		}
		let capabilities = self
			.detect_token_capabilities(chain_id, token_address)
			.await?;
		Ok(capabilities)
	}

	async fn detect_token_capabilities(
		&self,
		chain_id: u64,
		_token_address: Address,
	) -> Result<TokenCapabilities, QuoteError> {
		let permit2_available = self.permit2_addresses.contains_key(&chain_id);
		let supports_erc3009 = false;
		Ok(TokenCapabilities {
			supports_erc3009,
			permit2_available,
		})
	}

	pub fn default_permit2_addresses() -> HashMap<u64, Address> {
		let mut addresses = HashMap::new();
		addresses.insert(
			1,
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
				.parse()
				.unwrap(),
		);
		addresses.insert(
			137,
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
				.parse()
				.unwrap(),
		);
		addresses.insert(
			42161,
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
				.parse()
				.unwrap(),
		);
		addresses.insert(
			10,
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
				.parse()
				.unwrap(),
		);
		addresses.insert(
			8453,
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
				.parse()
				.unwrap(),
		);
		addresses.insert(
			31337,
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
				.parse()
				.unwrap(),
		);
		addresses.insert(
			31338,
			"0x000000000022D473030F116dDEE9F6B43aC78BA3"
				.parse()
				.unwrap(),
		);
		addresses
	}
}

impl Default for CustodyStrategy {
	fn default() -> Self {
		Self::new()
	}
}
