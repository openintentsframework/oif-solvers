//! Simple price feed service for demo tokens.
//!
//! This module provides basic USD pricing for TOKA ($1) and TOKB ($2) tokens
//! used in local development and testing.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use solver_types::current_timestamp;

/// Errors that can occur during price operations.
#[derive(Debug, thiserror::Error)]
pub enum PriceError {
    #[error("Token not supported: {0}")]
    TokenNotSupported(String),
    #[error("Configuration error: {0}")]
    Configuration(String),
}

/// Request for token price information.
#[derive(Debug, Clone)]
pub struct PriceRequest {
    pub token_address: String,
    pub chain_id: u64,
}

/// Token price information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPrice {
    pub token_address: String,
    pub chain_id: u64,
    pub symbol: String,
    pub price_usd: String,
    pub decimals: u8,
    pub last_updated: u64,
    pub source: String,
}

/// Simple price feed service for demo tokens.
pub struct PriceService {
    prices: HashMap<String, String>,
}

impl PriceService {
    /// Create a new price service with demo token prices.
    pub fn new() -> Self {
        let mut prices = HashMap::new();
        prices.insert("TOKA".to_string(), "1.00".to_string());
        prices.insert("TOKB".to_string(), "2.00".to_string());

        Self { prices }
    }

    /// Get price for a token.
    pub async fn get_token_price(&self, request: &PriceRequest) -> Result<TokenPrice, PriceError> {
        let symbol = self.get_token_symbol(&request.token_address);
        
        let price_usd = self.prices.get(&symbol)
            .cloned()
            .unwrap_or_else(|| "1.0".to_string()); // fallback price

        Ok(TokenPrice {
            token_address: request.token_address.clone(),
            chain_id: request.chain_id,
            symbol,
            price_usd,
            decimals: 18, // assume 18 decimals for demo tokens
            last_updated: current_timestamp(),
            source: "demo".to_string(),
        })
    }

    /// Get token symbol from address (demo tokens only).
    fn get_token_symbol(&self, token_address: &str) -> String {
        let addr = token_address.to_lowercase();
        match addr.as_str() {
            "0x5fbdb2315678afecb367f032d93f642f64180aa3" => "TOKA".to_string(),
            "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" => "TOKB".to_string(),
            _ => "UNKNOWN".to_string(),
        }
    }
}

impl Default for PriceService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_demo_token_prices() {
        let service = PriceService::new();

        // Test TOKA
        let toka_request = PriceRequest {
            token_address: "0x5FbDB2315678afecb367f032d93F642f64180aa3".to_string(),
            chain_id: 31337,
        };
        let toka_price = service.get_token_price(&toka_request).await.unwrap();
        assert_eq!(toka_price.symbol, "TOKA");
        assert_eq!(toka_price.price_usd, "1.00");

        // Test TOKB
        let tokb_request = PriceRequest {
            token_address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512".to_string(),
            chain_id: 31338,
        };
        let tokb_price = service.get_token_price(&tokb_request).await.unwrap();
        assert_eq!(tokb_price.symbol, "TOKB");
        assert_eq!(tokb_price.price_usd, "2.00");
    }

    #[tokio::test]
    async fn test_unknown_token() {
        let service = PriceService::new();
        
        let request = PriceRequest {
            token_address: "0xunknown".to_string(),
            chain_id: 999,
        };
        let price = service.get_token_price(&request).await.unwrap();
        assert_eq!(price.symbol, "UNKNOWN");
        assert_eq!(price.price_usd, "1.0"); // fallback
    }
}