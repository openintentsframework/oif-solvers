//! Quote Business Logic Module
//!
//! This module contains the core business logic for quote processing,
//! separated from the HTTP API layer for better maintainability and testing.

pub mod generation;
pub mod settlement;
pub mod validation;

// Re-export main functionality
pub use generation::QuoteGenerator;
// pub use settlement::SettlementStrategy;
pub use validation::QuoteValidator;

// Main API function
use solver_config::Config;
use solver_core::SolverEngine;
use solver_types::{GetQuoteRequest, GetQuoteResponse, QuoteError};
use tracing::info;

/// Processes a quote request and returns available quote options.
///
/// This is the main HTTP API entry point that orchestrates the quote processing
/// pipeline by delegating to specialized modules.
pub async fn process_quote_request(
	request: GetQuoteRequest,
	_solver: &SolverEngine,
	config: &Config,
) -> Result<GetQuoteResponse, QuoteError> {
	info!(
		"Processing quote request with {} inputs",
		request.available_inputs.len()
	);

	// 1. Validate the request
	QuoteValidator::validate_request(&request)?;

	// 2. Check solver capabilities
	// TODO: Implement solver capability checking

	// 3. Generate quotes using the business logic layer
	let quote_generator = QuoteGenerator::new();
	let quotes = quote_generator.generate_quotes(&request, config).await?;

	info!("Generated {} quote options", quotes.len());

	Ok(GetQuoteResponse { quotes })
}