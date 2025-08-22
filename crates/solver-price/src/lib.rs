//! Price feed module for the OIF solver system.
//!
//! This module provides interfaces and implementations for fetching token prices
//! across different chains. It supports multiple price data sources and follows
//! the same trait-based pattern as other solver components.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use solver_types::{ConfigSchema, ImplementationRegistry};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

/// Re-export implementations
pub mod implementations {
    pub mod mock;
    // Future implementations:
    // pub mod coingecko;
    // pub mod chainlink;
    // pub mod storage;
}

/// Errors that can occur during price feed operations.
#[derive(Debug, Error)]
pub enum PriceFeedError {
    /// Error that occurs during network communication with price data sources.
    #[error("Network error: {0}")]
    Network(String),
    /// Error that occurs when a token is not supported by the price feed.
    #[error("Token not supported: {0} on chain {1}")]
    TokenNotSupported(String, u64),
    /// Error that occurs when price data is temporarily unavailable.
    #[error("Price data unavailable: {0}")]
    PriceUnavailable(String),
    /// Internal error that occurs during price feed operations.
    #[error("Internal error: {0}")]
    Internal(String),
    /// Error that occurs when configuration is invalid.
    #[error("Configuration error: {0}")]
    Configuration(String),
}

/// Represents a token price in USD with metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPrice {
    /// The token address
    pub token_address: String,
    /// The chain ID where the token exists
    pub chain_id: u64,
    /// The token symbol (e.g., "WETH", "USDC")
    pub symbol: String,
    /// The price in USD as a string to maintain precision
    pub price_usd: String,
    /// Number of decimal places for the token
    pub decimals: u8,
    /// Timestamp when the price was last updated (Unix timestamp)
    pub last_updated: u64,
    /// The source of the price data (e.g., "coingecko", "chainlink", "mock")
    pub source: String,
}

/// Request structure for fetching token prices.
#[derive(Debug, Clone)]
pub struct PriceRequest {
    /// The token address to get price for
    pub token_address: String,
    /// The chain ID where the token exists
    pub chain_id: u64,
}

/// Trait defining the interface for price feed implementations.
///
/// This trait must be implemented by any price feed that wants to integrate
/// with the solver system. It provides methods for fetching individual token
/// prices and batch price requests.
#[async_trait]
pub trait PriceFeedInterface: Send + Sync {
    /// Returns the configuration schema for this price feed implementation.
    ///
    /// This allows each implementation to define its own configuration requirements
    /// with specific validation rules. The schema is used to validate TOML configuration
    /// before initializing the price feed.
    fn config_schema(&self) -> Box<dyn ConfigSchema>;

    /// Get the price of a single token in USD.
    ///
    /// # Arguments
    ///
    /// * `request` - The price request containing token address and chain ID
    ///
    /// # Returns
    ///
    /// The token price information or an error if the price cannot be fetched.
    async fn get_token_price(&self, request: &PriceRequest) -> Result<TokenPrice, PriceFeedError>;


}

/// Type alias for price feed factory functions.
///
/// This is the function signature that all price feed implementations must provide
/// to create instances of their price feed interface.
pub type PriceFeedFactory = fn(&toml::Value) -> Result<Box<dyn PriceFeedInterface>, PriceFeedError>;

/// Registry trait for price feed implementations.
///
/// This trait extends the base ImplementationRegistry to specify that
/// price feed implementations must provide a PriceFeedFactory.
pub trait PriceFeedRegistry: ImplementationRegistry<Factory = PriceFeedFactory> {}

/// Get all registered price feed implementations.
///
/// Returns a vector of (name, factory) tuples for all available price feed implementations.
/// This is used by the factory registry to automatically register all implementations.
pub fn get_all_implementations() -> Vec<(&'static str, PriceFeedFactory)> {
    use implementations::mock;

    vec![
        (mock::Registry::NAME, mock::Registry::factory()),
    ]
}

/// Service that manages price feeds with multiple implementations.
///
/// The PriceFeedService coordinates between different price feed implementations
/// and provides a unified interface for fetching token prices.
pub struct PriceFeedService {
    /// Map of implementation names to their interfaces.
    implementations: HashMap<String, Arc<dyn PriceFeedInterface>>,
    /// The primary implementation to use for price fetching.
    primary_implementation: String,
}

impl PriceFeedService {
    /// Creates a new PriceFeedService with the given implementations.
    ///
    /// # Arguments
    ///
    /// * `implementations` - Map of implementation names to their interfaces
    /// * `primary_implementation` - The name of the primary implementation to use
    pub fn new(
        implementations: HashMap<String, Arc<dyn PriceFeedInterface>>,
        primary_implementation: String,
    ) -> Result<Self, PriceFeedError> {
        if !implementations.contains_key(&primary_implementation) {
            return Err(PriceFeedError::Configuration(format!(
                "Primary implementation '{}' not found in available implementations",
                primary_implementation
            )));
        }

        Ok(Self {
            implementations,
            primary_implementation,
        })
    }

    /// Get the price of a single token using the primary implementation.
    pub async fn get_token_price(&self, request: &PriceRequest) -> Result<TokenPrice, PriceFeedError> {
        let implementation = self.implementations.get(&self.primary_implementation)
            .ok_or_else(|| PriceFeedError::Internal(
                format!("Primary implementation '{}' not available", self.primary_implementation)
            ))?;
        
        implementation.get_token_price(request).await
    }


}