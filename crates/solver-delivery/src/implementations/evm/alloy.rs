//! Transaction delivery implementations for the solver service.
//!
//! This module provides concrete implementations of the DeliveryInterface trait,
//! supporting blockchain transaction submission and monitoring using the Alloy library.

use crate::{DeliveryError, DeliveryInterface};
use alloy_network::EthereumWallet;
use alloy_primitives::{Address, FixedBytes, U256};
use alloy_provider::{Provider, ProviderBuilder};
use alloy_rpc_types::TransactionRequest;
use alloy_signer::Signer;
use alloy_signer_local::PrivateKeySigner;
use alloy_transport_http::Http;
use async_trait::async_trait;
use solver_types::{
	with_0x_prefix, ConfigSchema, Field, FieldType, NetworksConfig, Schema,
	Transaction as SolverTransaction, TransactionHash, TransactionReceipt,
};
use std::collections::HashMap;
use std::sync::Arc;

/// Alloy-based EVM delivery implementation.
///
/// This implementation uses the Alloy library to submit and monitor transactions
/// on EVM-compatible blockchains. It handles transaction signing, submission,
/// and confirmation tracking. Supports multiple networks with a single instance.
pub struct AlloyDelivery {
	/// Alloy providers for each supported network.
	providers: HashMap<u64, Arc<dyn Provider<Http<reqwest::Client>> + Send + Sync>>,
}

impl AlloyDelivery {
	/// Creates a new AlloyDelivery instance.
	///
	/// Configures Alloy providers for multiple networks with the specified
	/// RPC URLs and signers for transaction submission. The default_signer is used
	/// for networks that don't have a specific signer configured.
	pub async fn new(
		network_ids: Vec<u64>,
		networks: &NetworksConfig,
		signers: HashMap<u64, PrivateKeySigner>,
		default_signer: PrivateKeySigner,
	) -> Result<Self, DeliveryError> {
		// Validate at least one network
		if network_ids.is_empty() {
			return Err(DeliveryError::Network(
				"At least one network_id must be specified".to_string(),
			));
		}

		let mut providers = HashMap::new();

		for network_id in &network_ids {
			// Get network configuration
			let network = networks.get(network_id).ok_or_else(|| {
				DeliveryError::Network(format!("Network {} not found in configuration", network_id))
			})?;

			// Get HTTP URL from network configuration
			let http_url = network.get_http_url().ok_or_else(|| {
				DeliveryError::Network(format!(
					"No HTTP RPC URL configured for network {}",
					network_id
				))
			})?;

			// Parse RPC URL
			let url = http_url.parse().map_err(|e| {
				DeliveryError::Network(format!("Invalid RPC URL for network {}: {}", network_id, e))
			})?;

			// Get the signer for this network, or use the default
			let signer = signers.get(network_id).unwrap_or(&default_signer);

			// Create signer with chain ID
			let chain_signer = signer.clone().with_chain_id(Some(*network_id));
			let wallet = EthereumWallet::from(chain_signer);

			// Create provider
			let provider = ProviderBuilder::new()
				.with_recommended_fillers()
				.wallet(wallet)
				.on_http(url);

			provider
				.client()
				.set_poll_interval(std::time::Duration::from_secs(7));

			providers.insert(
				*network_id,
				Arc::new(provider) as Arc<dyn Provider<Http<reqwest::Client>> + Send + Sync>,
			);
		}

		Ok(Self { providers })
	}

	/// Gets the provider for a specific chain ID.
	fn get_provider(
		&self,
		chain_id: u64,
	) -> Result<&Arc<dyn Provider<Http<reqwest::Client>> + Send + Sync>, DeliveryError> {
		self.providers.get(&chain_id).ok_or_else(|| {
			DeliveryError::Network(format!("No provider configured for chain ID {}", chain_id))
		})
	}
}

/// Configuration schema for Alloy delivery provider.
///
/// This schema defines the required configuration fields for the Alloy
/// delivery provider, including RPC URL and chain ID validation.
pub struct AlloyDeliverySchema;

impl AlloyDeliverySchema {
	/// Static validation method for use before instance creation
	pub fn validate_config(config: &toml::Value) -> Result<(), solver_types::ValidationError> {
		let instance = Self;
		instance.validate(config)
	}
}

impl ConfigSchema for AlloyDeliverySchema {
	fn validate(&self, config: &toml::Value) -> Result<(), solver_types::ValidationError> {
		let schema = Schema::new(
			// Required fields
			vec![Field::new(
				"network_ids",
				FieldType::Array(Box::new(FieldType::Integer {
					min: Some(1),
					max: None,
				})),
			)
			.with_validator(|value| {
				if let Some(arr) = value.as_array() {
					if arr.is_empty() {
						return Err("network_ids cannot be empty".to_string());
					}
					Ok(())
				} else {
					Err("network_ids must be an array".to_string())
				}
			})],
			// Optional fields
			vec![Field::new(
				"accounts",
				FieldType::Table(Schema::new(
					vec![], // No required fields - network IDs are dynamic
					vec![], // No optional fields - all entries should be account names
				)),
			)
			.with_validator(|value| {
				if let Some(table) = value.as_table() {
					// Validate that keys are valid integers (network IDs)
					// and values are strings (account names)
					for (key, val) in table {
						// Try to parse key as network ID
						if key.parse::<u64>().is_err() {
							return Err(format!("Invalid network ID in accounts: {}", key));
						}
						// Check value is a string
						if !val.is_str() {
							return Err(format!(
								"Account name for network {} must be a string",
								key
							));
						}
					}
					Ok(())
				} else {
					Err("accounts must be a table".to_string())
				}
			})],
		);

		schema.validate(config)
	}
}

#[async_trait]
impl DeliveryInterface for AlloyDelivery {
	fn config_schema(&self) -> Box<dyn ConfigSchema> {
		Box::new(AlloyDeliverySchema)
	}

	async fn submit(&self, tx: SolverTransaction) -> Result<TransactionHash, DeliveryError> {
		// Get the chain ID from the transaction
		let chain_id = tx.chain_id;

		// Get the appropriate provider for this chain
		let provider = self.get_provider(chain_id)?;

		// Convert solver transaction to alloy transaction request
		let request: TransactionRequest = tx.into();

		// Send transaction - the provider's wallet will handle signing
		let pending_tx = provider
			.send_transaction(request)
			.await
			.map_err(|e| DeliveryError::Network(format!("Failed to send transaction: {}", e)))?;

		// Get the transaction hash
		let tx_hash = *pending_tx.tx_hash();
		let hash_str = with_0x_prefix(&hex::encode(tx_hash.0));
		tracing::info!(tx_hash = %hash_str, chain_id = chain_id, "Submitted transaction");

		Ok(TransactionHash(tx_hash.0.to_vec()))
	}

	async fn wait_for_confirmation(
		&self,
		hash: &TransactionHash,
		chain_id: u64,
		confirmations: u64,
	) -> Result<TransactionReceipt, DeliveryError> {
		let tx_hash = FixedBytes::<32>::from_slice(&hash.0);

		// Poll interval for checking confirmations
		let poll_interval = tokio::time::Duration::from_secs(10);
		// Allow ~15 seconds per confirmation (typical block time) plus some buffer
		let seconds_per_confirmation = 20;
		let max_timeout = 3600; // Cap at 1 hour
		let timeout_seconds = (confirmations * seconds_per_confirmation)
			.max(seconds_per_confirmation)
			.min(max_timeout);
		let max_wait_time = tokio::time::Duration::from_secs(timeout_seconds);
		let start_time = tokio::time::Instant::now();

		// Log high-level info about what we're doing
		tracing::info!(
			"Waiting for {} confirmations (timeout: {}s)",
			confirmations,
			timeout_seconds
		);

		let provider = self.get_provider(chain_id)?;

		loop {
			// Check if we've exceeded max wait time
			if start_time.elapsed() > max_wait_time {
				return Err(DeliveryError::Network(format!(
					"Timeout waiting for {} confirmations after {} seconds",
					confirmations,
					max_wait_time.as_secs()
				)));
			}

			// Get transaction receipt
			let receipt = match provider.get_transaction_receipt(tx_hash).await {
				Ok(Some(receipt)) => receipt,
				Ok(None) => {
					// Transaction not yet mined, wait and retry
					tokio::time::sleep(poll_interval).await;
					continue;
				},
				Err(e) => {
					return Err(DeliveryError::Network(format!(
						"Failed to get receipt: {}",
						e
					)));
				},
			};

			// Get current block number
			let current_block = provider.get_block_number().await.map_err(|e| {
				DeliveryError::Network(format!("Failed to get block number: {}", e))
			})?;

			let tx_block = receipt.block_number.unwrap_or(0);
			let current_confirmations = current_block.saturating_sub(tx_block);

			// Check if we have enough confirmations
			if current_confirmations >= confirmations {
				return Ok(TransactionReceipt {
					hash: TransactionHash(receipt.transaction_hash.0.to_vec()),
					block_number: tx_block,
					success: receipt.status(),
				});
			}

			tracing::debug!(
				"Waiting for {} more confirmations...",
				confirmations.saturating_sub(current_confirmations)
			);

			// Not enough confirmations yet, wait and retry
			tokio::time::sleep(poll_interval).await;
		}
	}

	async fn get_receipt(
		&self,
		hash: &TransactionHash,
		chain_id: u64,
	) -> Result<TransactionReceipt, DeliveryError> {
		let tx_hash = FixedBytes::<32>::from_slice(&hash.0);

		// Get the provider for the specified chain
		let provider = self.get_provider(chain_id)?;

		match provider.get_transaction_receipt(tx_hash).await {
			Ok(Some(receipt)) => Ok(TransactionReceipt {
				hash: TransactionHash(receipt.transaction_hash.0.to_vec()),
				block_number: receipt.block_number.unwrap_or(0),
				success: receipt.status(),
			}),
			Ok(None) => Err(DeliveryError::Network(format!(
				"Transaction not found on chain {}",
				chain_id
			))),
			Err(e) => Err(DeliveryError::Network(format!(
				"Failed to get receipt on chain {}: {}",
				chain_id, e
			))),
		}
	}

	async fn get_gas_price(&self, chain_id: u64) -> Result<String, DeliveryError> {
		let provider = self.get_provider(chain_id)?;

		let gas_price = provider
			.get_gas_price()
			.await
			.map_err(|e| DeliveryError::Network(format!("Failed to get gas price: {}", e)))?;

		Ok(gas_price.to_string())
	}

	async fn get_balance(
		&self,
		address: &str,
		token: Option<&str>,
		chain_id: u64,
	) -> Result<String, DeliveryError> {
		let address: Address = address
			.parse()
			.map_err(|e| DeliveryError::Network(format!("Invalid address: {}", e)))?;

		let provider = self.get_provider(chain_id)?;

		match token {
			None => {
				// Get native token balance
				let balance = provider
					.get_balance(address)
					.await
					.map_err(|e| DeliveryError::Network(format!("Failed to get balance: {}", e)))?;

				Ok(balance.to_string())
			},
			Some(token_address) => {
				// Get ERC-20 token balance
				let token_addr: Address = token_address
					.parse()
					.map_err(|e| DeliveryError::Network(format!("Invalid token address: {}", e)))?;

				// Create the balanceOf call data
				// balanceOf(address) selector is 0x70a08231
				let selector = [0x70, 0xa0, 0x82, 0x31];
				let mut call_data = Vec::new();
				call_data.extend_from_slice(&selector);
				call_data.extend_from_slice(&[0; 12]); // Pad to 32 bytes
				call_data.extend_from_slice(address.as_slice());

				let call_result = provider
					.call(
						&TransactionRequest::default()
							.to(token_addr)
							.input(call_data.into()),
					)
					.await
					.map_err(|e| {
						DeliveryError::Network(format!("Failed to call balanceOf: {}", e))
					})?;

				if call_result.len() < 32 {
					return Err(DeliveryError::Network(
						"Invalid balanceOf response".to_string(),
					));
				}

				let balance = U256::from_be_slice(&call_result[..32]);
				Ok(balance.to_string())
			},
		}
	}

	async fn get_allowance(
		&self,
		owner: &str,
		spender: &str,
		token_address: &str,
		chain_id: u64,
	) -> Result<String, DeliveryError> {
		let owner_addr: Address = owner
			.parse()
			.map_err(|e| DeliveryError::Network(format!("Invalid owner address: {}", e)))?;

		let spender_addr: Address = spender
			.parse()
			.map_err(|e| DeliveryError::Network(format!("Invalid spender address: {}", e)))?;

		let token_addr: Address = token_address
			.parse()
			.map_err(|e| DeliveryError::Network(format!("Invalid token address: {}", e)))?;

		let provider = self.get_provider(chain_id)?;

		// Create the allowance call data
		// allowance(address,address) selector is 0xdd62ed3e
		let selector = [0xdd, 0x62, 0xed, 0x3e];
		let mut call_data = Vec::new();
		call_data.extend_from_slice(&selector);
		call_data.extend_from_slice(&[0; 12]); // Pad owner address to 32 bytes
		call_data.extend_from_slice(owner_addr.as_slice());
		call_data.extend_from_slice(&[0; 12]); // Pad spender address to 32 bytes
		call_data.extend_from_slice(spender_addr.as_slice());

		let call_request = TransactionRequest::default()
			.to(token_addr)
			.input(call_data.into());

		let call_result = provider
			.call(&call_request)
			.await
			.map_err(|e| DeliveryError::Network(format!("Failed to call allowance: {}", e)))?;

		if call_result.len() < 32 {
			return Err(DeliveryError::Network(
				"Invalid allowance response".to_string(),
			));
		}

		let allowance = U256::from_be_slice(&call_result[..32]);
		Ok(allowance.to_string())
	}

	async fn get_nonce(&self, address: &str, chain_id: u64) -> Result<u64, DeliveryError> {
		let address: Address = address
			.parse()
			.map_err(|e| DeliveryError::Network(format!("Invalid address: {}", e)))?;

		let provider = self.get_provider(chain_id)?;

		provider
			.get_transaction_count(address)
			.await
			.map_err(|e| DeliveryError::Network(format!("Failed to get nonce: {}", e)))
	}

	async fn get_block_number(&self, chain_id: u64) -> Result<u64, DeliveryError> {
		let provider = self.get_provider(chain_id)?;

		provider
			.get_block_number()
			.await
			.map_err(|e| DeliveryError::Network(format!("Failed to get block number: {}", e)))
	}

	async fn estimate_gas(&self, tx: SolverTransaction) -> Result<u64, DeliveryError> {
		// Get the chain ID from the transaction
		let chain_id = tx.chain_id;

		// Get the appropriate provider for this chain
		let provider = self.get_provider(chain_id)?;

		// Convert to TransactionRequest
		let request: TransactionRequest = tx.into();

		// The provider with wallet will automatically handle setting the `from` field
		// when needed for gas estimation
		let gas = provider
			.estimate_gas(&request)
			.await
			.map_err(|e| DeliveryError::Network(format!("Failed to estimate gas: {}", e)))?;
		Ok(gas)
	}
}

/// Factory function to create an HTTP-based delivery provider from configuration.
///
/// This function reads the delivery configuration and creates an AlloyDelivery
/// instance.
///
/// # Parameters
/// - `config`: TOML configuration containing:
///   - `network_ids` (required): Array of network IDs to support
///   - `accounts` (optional): Map of network IDs to account names for per-network signing
/// - `networks`: Network configuration containing RPC URLs and contract addresses
/// - `default_private_key`: Default private key for signing transactions
/// - `network_private_keys`: Map of network IDs to private keys for per-network signing
///
/// # Returns
/// A boxed implementation of DeliveryInterface configured for the specified networks
pub fn create_http_delivery(
	config: &toml::Value,
	networks: &NetworksConfig,
	default_private_key: &solver_types::SecretString,
	network_private_keys: &HashMap<u64, solver_types::SecretString>,
) -> Result<Box<dyn DeliveryInterface>, DeliveryError> {
	// Validate configuration first
	AlloyDeliverySchema::validate_config(config)
		.map_err(|e| DeliveryError::Network(format!("Invalid configuration: {}", e)))?;

	// Parse network_ids (required field)
	let network_ids = config
		.get("network_ids")
		.and_then(|v| v.as_array())
		.map(|arr| {
			arr.iter()
				.filter_map(|v| v.as_integer().map(|i| i as u64))
				.collect::<Vec<_>>()
		})
		.ok_or_else(|| DeliveryError::Network("network_ids is required".to_string()))?;

	if network_ids.is_empty() {
		return Err(DeliveryError::Network(
			"network_ids cannot be empty".to_string(),
		));
	}

	// Parse the default signer
	let default_signer: PrivateKeySigner = default_private_key.with_exposed(|key| {
		key.parse()
			.map_err(|_| DeliveryError::Network("Invalid default private key format".to_string()))
	})?;

	// Parse network-specific signers
	let mut network_signers = HashMap::new();
	for (network_id, private_key) in network_private_keys {
		let signer: PrivateKeySigner = private_key.with_exposed(|key| {
			key.parse().map_err(|_| {
				DeliveryError::Network(format!(
					"Invalid private key format for network {}",
					network_id
				))
			})
		})?;
		network_signers.insert(*network_id, signer);
	}

	// Create delivery service synchronously, but the actual connection happens async
	let delivery = tokio::task::block_in_place(|| {
		tokio::runtime::Handle::current().block_on(async {
			AlloyDelivery::new(network_ids, networks, network_signers, default_signer).await
		})
	})?;

	Ok(Box::new(delivery))
}

/// Registry for the HTTP/Alloy delivery implementation.
pub struct Registry;

impl solver_types::ImplementationRegistry for Registry {
	const NAME: &'static str = "evm_alloy";
	type Factory = crate::DeliveryFactory;

	fn factory() -> Self::Factory {
		create_http_delivery
	}
}

impl crate::DeliveryRegistry for Registry {}
