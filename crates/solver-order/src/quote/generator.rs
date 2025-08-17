//! Quote Generation Logic (moved from solver-service)

use solver_config::Config;
use solver_types::{
	GetQuoteRequest, InteropAddress, Quote, QuoteDetails, QuoteError, QuoteOrder, QuotePreference,
	SignatureType,
};

use uuid::Uuid;

use super::custody_strategy::{CustodyDecision, CustodyStrategy, EscrowKind, LockKind};

/// Quote generation engine
pub struct QuoteGenerator {
	custody_strategy: CustodyStrategy,
}

impl QuoteGenerator {
	pub fn new() -> Self {
		Self {
			custody_strategy: CustodyStrategy::new(),
		}
	}

	pub async fn generate_quotes(
		&self,
		request: &GetQuoteRequest,
		config: &Config,
	) -> Result<Vec<Quote>, QuoteError> {
		let mut quotes = Vec::new();
		for input in &request.available_inputs {
			let settlement_decision = self.custody_strategy.decide_custody(input).await?;
			if let Ok(quote) = self
				.generate_quote_for_settlement(request, config, &settlement_decision)
				.await
			{
				quotes.push(quote);
			}
		}
		if quotes.is_empty() {
			return Err(QuoteError::InsufficientLiquidity);
		}
		self.sort_quotes_by_preference(&mut quotes, &request.preference);
		Ok(quotes)
	}

	async fn generate_quote_for_settlement(
		&self,
		request: &GetQuoteRequest,
		config: &Config,
		settlement_decision: &CustodyDecision,
	) -> Result<Quote, QuoteError> {
		let quote_id = Uuid::new_v4().to_string();
		let order = match settlement_decision {
			CustodyDecision::ResourceLock { kind } => {
				self.generate_resource_lock_order(request, config, kind)?
			}
			CustodyDecision::Escrow { kind } => {
				self.generate_escrow_order(request, config, kind)?
			}
		};
		let details = QuoteDetails {
			requested_outputs: request.requested_outputs.clone(),
			available_inputs: request.available_inputs.clone(),
		};
		let eta = self.calculate_eta(&request.preference);
		Ok(Quote {
			orders: vec![order],
			details,
			valid_until: Some(chrono::Utc::now().timestamp() as u64 + 300),
			eta: Some(eta),
			quote_id,
			provider: "oif-solver".to_string(),
		})
	}

	fn generate_resource_lock_order(
		&self,
		request: &GetQuoteRequest,
		config: &Config,
		lock_kind: &LockKind,
	) -> Result<QuoteOrder, QuoteError> {
		let domain_address = self.get_lock_domain_address(config, lock_kind)?;
		let (primary_type, message) = match lock_kind {
			LockKind::TheCompact { params } => (
				"CompactLock".to_string(),
				self.build_compact_message(request, params)?,
			),
		};
		Ok(QuoteOrder {
			signature_type: SignatureType::Eip712,
			domain: domain_address,
			primary_type,
			message,
		})
	}

	fn generate_escrow_order(
		&self,
		request: &GetQuoteRequest,
		config: &Config,
		escrow_kind: &EscrowKind,
	) -> Result<QuoteOrder, QuoteError> {
		match escrow_kind {
			EscrowKind::Permit2 => self.generate_permit2_order(request, config),
			EscrowKind::Erc3009 => self.generate_erc3009_order(request, config),
		}
	}

	fn generate_permit2_order(
		&self,
		request: &GetQuoteRequest,
		config: &Config,
	) -> Result<QuoteOrder, QuoteError> {
		use crate::signing::payloads::permit2 as permit2_payload;
		use alloy_primitives::hex;
		use solver_types::utils::with_0x_prefix;

		let chain_id = request.available_inputs[0]
			.asset
			.ethereum_chain_id()
			.map_err(|e| {
				QuoteError::InvalidRequest(format!("Invalid chain ID in asset address: {}", e))
			})?;
		let domain_address = permit2_payload::permit2_domain_address_from_config(config, chain_id)?;
		let (final_digest, message_obj) =
			permit2_payload::build_permit2_batch_witness_digest(request, config)?;
		let message = serde_json::json!({ "digest": with_0x_prefix(&hex::encode(final_digest)), "eip712": message_obj });
		Ok(QuoteOrder {
			signature_type: SignatureType::Eip712,
			domain: domain_address,
			primary_type: "PermitBatchWitnessTransferFrom".to_string(),
			message,
		})
	}

	fn generate_erc3009_order(
		&self,
		request: &GetQuoteRequest,
		config: &Config,
	) -> Result<QuoteOrder, QuoteError> {
		let input = &request.available_inputs[0];
		let domain_address = input.asset.clone();
		let message = serde_json::json!({
			"from": input.user.ethereum_address().map_err(|e| QuoteError::InvalidRequest(format!("Invalid Ethereum address: {}", e)))?,
			"to": self.get_escrow_address(config)?,
			"value": input.amount.to_string(),
			"validAfter": 0,
			"validBefore": chrono::Utc::now().timestamp() + 300,
			"nonce": format!("0x{:064x}", chrono::Utc::now().timestamp() as u64)
		});
		Ok(QuoteOrder {
			signature_type: SignatureType::Erc3009,
			domain: domain_address,
			primary_type: "ReceiveWithAuthorization".to_string(),
			message,
		})
	}

	fn build_compact_message(
		&self,
		request: &GetQuoteRequest,
		_params: &serde_json::Value,
	) -> Result<serde_json::Value, QuoteError> {
		Ok(serde_json::json!({
			"user": request.user,
			"inputs": request.available_inputs,
			"outputs": request.requested_outputs,
			"nonce": chrono::Utc::now().timestamp(),
			"deadline": chrono::Utc::now().timestamp() + 300
		}))
	}

	fn get_lock_domain_address(
		&self,
		config: &Config,
		lock_kind: &LockKind,
	) -> Result<InteropAddress, QuoteError> {
		match &config.settlement.domain {
			Some(domain_config) => {
				let address = domain_config.address.parse().map_err(|e| {
					QuoteError::InvalidRequest(format!("Invalid domain address in config: {}", e))
				})?;
				Ok(InteropAddress::new_ethereum(
					domain_config.chain_id,
					address,
				))
			}
			None => Err(QuoteError::InvalidRequest(format!(
				"Domain configuration required for lock type: {:?}",
				lock_kind
			))),
		}
	}

	fn get_escrow_address(&self, config: &Config) -> Result<alloy_primitives::Address, QuoteError> {
		match &config.settlement.domain {
			Some(domain_config) => domain_config.address.parse().map_err(|e| {
				QuoteError::InvalidRequest(format!("Invalid escrow address in config: {}", e))
			}),
			None => Err(QuoteError::InvalidRequest(
				"Escrow address configuration required".to_string(),
			)),
		}
	}

	fn calculate_eta(&self, preference: &Option<QuotePreference>) -> u64 {
		let base_eta = 120u64;
		match preference {
			Some(QuotePreference::Speed) => (base_eta as f64 * 0.8) as u64,
			Some(QuotePreference::Price) => (base_eta as f64 * 1.2) as u64,
			Some(QuotePreference::TrustMinimization) => (base_eta as f64 * 1.5) as u64,
			_ => base_eta,
		}
	}

	fn sort_quotes_by_preference(
		&self,
		quotes: &mut [Quote],
		preference: &Option<QuotePreference>,
	) {
		match preference {
			Some(QuotePreference::Speed) => quotes.sort_by(|a, b| match (a.eta, b.eta) {
				(Some(eta_a), Some(eta_b)) => eta_a.cmp(&eta_b),
				(Some(_), None) => std::cmp::Ordering::Less,
				(None, Some(_)) => std::cmp::Ordering::Greater,
				(None, None) => std::cmp::Ordering::Equal,
			}),
			Some(QuotePreference::InputPriority) => {}
			Some(QuotePreference::Price) | Some(QuotePreference::TrustMinimization) | None => {}
		}
	}
}

impl Default for QuoteGenerator {
	fn default() -> Self {
		Self::new()
	}
}
