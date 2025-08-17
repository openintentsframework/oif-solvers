use solver_types::{AvailableInput, LockKind as ApiLockKind, QuoteError};

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
pub struct CustodyStrategy {}

impl CustodyStrategy {
	pub fn new() -> Self {
		Self {}
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
		let capabilities = self.get_token_capabilities(chain_id).await?;
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

	async fn get_token_capabilities(&self, chain_id: u64) -> Result<TokenCapabilities, QuoteError> {
		self.detect_token_capabilities(chain_id).await
	}

	async fn detect_token_capabilities(
		&self,
		chain_id: u64,
	) -> Result<TokenCapabilities, QuoteError> {
		const PERMIT2_CHAINS: &[u64] = &[1, 137, 42161, 10, 8453, 31337, 31338];
		let permit2_available = PERMIT2_CHAINS.contains(&chain_id);

		// ERC3009 support would be detected per-token in the future
		let supports_erc3009 = false;

		Ok(TokenCapabilities {
			supports_erc3009,
			permit2_available,
		})
	}
}

impl Default for CustodyStrategy {
	fn default() -> Self {
		Self::new()
	}
}
