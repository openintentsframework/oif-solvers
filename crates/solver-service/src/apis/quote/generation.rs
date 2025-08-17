//! Quote Generation Logic
//!
//! This module handles the generation of quote options based on validated requests
//! and settlement strategy decisions.

use solver_config::Config;
use solver_order::quote::generator::QuoteGenerator as CoreQuoteGenerator;
use solver_types::{GetQuoteRequest, Quote, QuoteError};

/// Quote generation engine
pub struct QuoteGenerator {
	core: CoreQuoteGenerator,
}

impl QuoteGenerator {
	/// Create new quote generator
	pub fn new() -> Self {
		Self { core: CoreQuoteGenerator::new() }
	}

	/// Generate quotes for the given request
	pub async fn generate_quotes(
		&self,
		request: &GetQuoteRequest,
		config: &Config,
	) -> Result<Vec<Quote>, QuoteError> {
		self.core.generate_quotes(request, config).await
	}
}

impl Default for QuoteGenerator {
	fn default() -> Self {
		Self::new()
	}
}
