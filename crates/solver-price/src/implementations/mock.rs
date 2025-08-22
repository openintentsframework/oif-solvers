//! Mock price feed implementation for testing and development.
//!
//! This implementation provides hardcoded token prices for popular tokens
//! across different chains. It's designed for development and testing scenarios
//! where live price data isn't needed or available.

use crate::{PriceFeedError, PriceFeedFactory, PriceFeedInterface, PriceFeedRegistry, PriceRequest, TokenPrice};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use solver_types::{current_timestamp, ConfigSchema, ImplementationRegistry, ValidationError};
use std::collections::HashMap;

/// Configuration for the mock price feed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockPriceFeedConfig {
    /// Whether to enable mock price feeds
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Custom price overrides (token_address@chain_id -> price_usd)
    #[serde(default)]
    pub price_overrides: HashMap<String, String>,
    /// Default price to use for unknown tokens
    #[serde(default = "default_fallback_price")]
    pub fallback_price_usd: String,
}

fn default_enabled() -> bool {
    true
}

fn default_fallback_price() -> String {
    "1.0".to_string()
}

impl Default for MockPriceFeedConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            price_overrides: HashMap::new(),
            fallback_price_usd: default_fallback_price(),
        }
    }
}

impl ConfigSchema for MockPriceFeedConfig {
    fn validate(&self, _config: &toml::value::Value) -> Result<(), ValidationError> {
        if !self.enabled {
            return Err(ValidationError::InvalidValue {
                field: "enabled".to_string(),
                message: "Mock price feed is disabled".to_string(),
            });
        }
        Ok(())
    }
}

/// Mock price feed implementation that provides hardcoded prices for common tokens.
pub struct MockPriceFeed {
    config: MockPriceFeedConfig,
    /// Hardcoded token prices (symbol -> price_usd)
    default_prices: HashMap<String, String>,
}

impl MockPriceFeed {
    /// Creates a new mock price feed with the given configuration.
    pub fn new(config: MockPriceFeedConfig) -> Self {
        let mut default_prices = HashMap::new();
        
        // Demo tokens for local development
        default_prices.insert("TOKA".to_string(), "1.00".to_string());
        default_prices.insert("TOKB".to_string(), "2.00".to_string());

        Self {
            config,
            default_prices,
        }
    }

    /// Get token symbol from address (simplified mock implementation).
    /// 
    /// In a real implementation, this would query token contracts or use
    /// a comprehensive token database. For now, we use common token addresses.
    fn get_token_symbol(&self, token_address: &str, _chain_id: u64) -> String {
        // Convert to lowercase for comparison
        let addr = token_address.to_lowercase();
        
        // Demo token addresses only
        match addr.as_str() {
            "0x5fbdb2315678afecb367f032d93f642f64180aa3" => "TOKA".to_string(),
            "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" => "TOKB".to_string(),
            _ => "UNKNOWN".to_string(),
        }
    }

    /// Get the price override key for a token.
    fn get_override_key(&self, token_address: &str, chain_id: u64) -> String {
        format!("{}@{}", token_address.to_lowercase(), chain_id)
    }
}

#[async_trait]
impl PriceFeedInterface for MockPriceFeed {
    fn config_schema(&self) -> Box<dyn ConfigSchema> {
        Box::new(self.config.clone())
    }

    async fn get_token_price(&self, request: &PriceRequest) -> Result<TokenPrice, PriceFeedError> {
        if !self.config.enabled {
            return Err(PriceFeedError::PriceUnavailable("Mock price feed is disabled".to_string()));
        }

        // Check for price overrides first
        let override_key = self.get_override_key(&request.token_address, request.chain_id);
        if let Some(override_price) = self.config.price_overrides.get(&override_key) {
            return Ok(TokenPrice {
                token_address: request.token_address.clone(),
                chain_id: request.chain_id,
                symbol: self.get_token_symbol(&request.token_address, request.chain_id),
                price_usd: override_price.clone(),
                decimals: 18, // Default to 18 decimals
                last_updated: current_timestamp(),
                source: "mock_override".to_string(),
            });
        }

        // Get token symbol and look up default price
        let symbol = self.get_token_symbol(&request.token_address, request.chain_id);
        
        let price_usd = self.default_prices
            .get(&symbol)
            .unwrap_or(&self.config.fallback_price_usd)
            .clone();

        Ok(TokenPrice {
            token_address: request.token_address.clone(),
            chain_id: request.chain_id,
            symbol,
            price_usd,
            decimals: 18, // Default to 18 decimals for simplicity
            last_updated: current_timestamp(),
            source: "mock".to_string(),
        })
    }


}

/// Registry for the mock price feed implementation.
pub struct Registry;

impl ImplementationRegistry for Registry {
    const NAME: &'static str = "mock";
    type Factory = PriceFeedFactory;

    fn factory() -> Self::Factory {
        |config: &toml::Value| -> Result<Box<dyn PriceFeedInterface>, PriceFeedError> {
            let mock_config: MockPriceFeedConfig = config.clone().try_into()
                .map_err(|e| PriceFeedError::Configuration(format!("Invalid mock config: {}", e)))?;

            Ok(Box::new(MockPriceFeed::new(mock_config)))
        }
    }
}

impl PriceFeedRegistry for Registry {}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_price_feed_demo_tokens() {
        let config = MockPriceFeedConfig::default();
        let feed = MockPriceFeed::new(config);

        // Test TOKA
        let toka_request = PriceRequest {
            token_address: "0x5FbDB2315678afecb367f032d93F642f64180aa3".to_string(), // TOKA
            chain_id: 31337,
        };

        let toka_price = feed.get_token_price(&toka_request).await.unwrap();
        assert_eq!(toka_price.symbol, "TOKA");
        assert_eq!(toka_price.price_usd, "1.00");
        assert_eq!(toka_price.chain_id, 31337);
        assert_eq!(toka_price.source, "mock");

        // Test TOKB
        let tokb_request = PriceRequest {
            token_address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512".to_string(), // TOKB
            chain_id: 31338,
        };

        let tokb_price = feed.get_token_price(&tokb_request).await.unwrap();
        assert_eq!(tokb_price.symbol, "TOKB");
        assert_eq!(tokb_price.price_usd, "2.00");
        assert_eq!(tokb_price.chain_id, 31338);
        assert_eq!(tokb_price.source, "mock");
    }

    #[tokio::test]
    async fn test_unknown_token_fallback() {
        let config = MockPriceFeedConfig::default();
        let feed = MockPriceFeed::new(config);

        let request = PriceRequest {
            token_address: "0xunknowntoken".to_string(),
            chain_id: 999,
        };

        let price = feed.get_token_price(&request).await.unwrap();
        assert_eq!(price.price_usd, "1.0"); // fallback price
        assert_eq!(price.symbol, "UNKNOWN");
        assert_eq!(price.source, "mock");
    }


}