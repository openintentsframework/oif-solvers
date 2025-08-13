//! Quote Request Validation
//!
//! This module handles validation of incoming quote requests,
//! ensuring all parameters are valid before processing.

use alloy_primitives::{Address as AlloyAddress, U256};
use solver_core::SolverEngine;
use solver_types::{GetQuoteRequest, InteropAddress, QuoteError};

/// Handles validation of quote requests
pub struct QuoteValidator;

/// Representation of a token amount on a specific chain that the solver supports
#[derive(Debug, Clone)]
pub struct SupportedAsset {
    pub chain_id: u64,
    pub evm_address: AlloyAddress,
    pub interop: InteropAddress,
    pub amount: U256,
}

impl QuoteValidator {
	/// Validates the incoming quote request
	pub fn validate_request(request: &GetQuoteRequest) -> Result<(), QuoteError> {
		Self::validate_basic_structure(request)?;
		Self::validate_user_address(request)?;
		Self::validate_inputs(request)?;
		Self::validate_outputs(request)?;
		Ok(())
	}

	/// Validates that chains in the request are supported by solver configuration.
	///
	/// Policy:
	/// - availableInputs must be on chains where `input_settler_address` is present (origin chains)
	/// - requested_outputs must be on chains where `output_settler_address` is present (destination chains)
	pub fn validate_supported_networks(
		request: &GetQuoteRequest,
		solver: &SolverEngine,
	) -> Result<(), QuoteError> {
		let networks = solver.token_manager().get_networks();

		// Build origin/destination support sets from configured networks
		let mut origin_supported = std::collections::HashSet::new();
		let mut destination_supported = std::collections::HashSet::new();

		for (chain_id, net) in networks.iter() {
			if !net.input_settler_address.0.is_empty() {
				origin_supported.insert(*chain_id);
			}
			if !net.output_settler_address.0.is_empty() {
				destination_supported.insert(*chain_id);
			}
		}

        // Validate available inputs (origin chains): at least one supported
        let mut supported_input_found = false;
        for input in &request.available_inputs {
            let chain_id = Self::chain_id_from_interop(&input.asset)?;
            tracing::info!("Checking input chain ID: {}", chain_id);
            if origin_supported.contains(&chain_id) {
                supported_input_found = true;
                break;
            }
        }
        if !supported_input_found {
            return Err(QuoteError::UnsupportedAsset(
                "None of the provided input chains are supported as origin".to_string(),
            ));
        }

		// Validate requested outputs (destination chains)
		for output in &request.requested_outputs {
			let chain_id = Self::chain_id_from_interop(&output.asset)?;
			if !destination_supported.contains(&chain_id) {
				return Err(QuoteError::UnsupportedAsset(format!(
					"Output chain {} not supported as destination",
					chain_id
				)));
			}
		}

		Ok(())
	}

	/// Validates that at least one provided asset (input or output)
	/// is a token supported by the solver on a supported chain.
	///
	/// The user may provide many tokens; we only require support for at least one
	/// token on at least one configured network.
	pub fn validate_supported_tokens(
		request: &GetQuoteRequest,
		solver: &SolverEngine,
	) -> Result<(), QuoteError> {
		let networks = solver.token_manager().get_networks();

        let mut found_supported = false;

		// Check available inputs
		for input in &request.available_inputs {
			let chain_id = Self::chain_id_from_interop(&input.asset)?;
            if let Ok(addr) = input.asset.ethereum_address() {
                if let Some(net) = networks.get(&chain_id) {
                    if net
                        .tokens
                        .iter()
                        .any(|t| t.address.0.as_slice() == addr.as_slice())
                    {
                        found_supported = true;
                    }
                }
            }
			if found_supported {
				return Ok(());
			}
		}

		// Check requested outputs
		for output in &request.requested_outputs {
			let chain_id = Self::chain_id_from_interop(&output.asset)?;
            if let Ok(addr) = output.asset.ethereum_address() {
                if let Some(net) = networks.get(&chain_id) {
                    if net
                        .tokens
                        .iter()
                        .any(|t| t.address.0.as_slice() == addr.as_slice())
                    {
                        found_supported = true;
                    }
                }
            }
			if found_supported {
				return Ok(());
			}
		}

		Err(QuoteError::UnsupportedAsset(
			"No supported tokens found in provided inputs/outputs".to_string(),
		))
	}

	/// Validates basic request structure
	fn validate_basic_structure(request: &GetQuoteRequest) -> Result<(), QuoteError> {
		// Check that we have at least one input
		if request.available_inputs.is_empty() {
			return Err(QuoteError::InvalidRequest(
				"At least one available input is required".to_string(),
			));
		}

		// Check that we have at least one requested output
		if request.requested_outputs.is_empty() {
			return Err(QuoteError::InvalidRequest(
				"At least one requested output is required".to_string(),
			));
		}

		Ok(())
	}

	/// Validates user address
	fn validate_user_address(request: &GetQuoteRequest) -> Result<(), QuoteError> {
		Self::validate_interop_address(&request.user)?;
		Ok(())
	}

	/// Validates input specifications
	fn validate_inputs(request: &GetQuoteRequest) -> Result<(), QuoteError> {
		for input in &request.available_inputs {
			Self::validate_interop_address(&input.user)?;
			Self::validate_interop_address(&input.asset)?;

			// Check that amount is positive
			if input.amount == U256::ZERO {
				return Err(QuoteError::InvalidRequest(
					"Input amount must be greater than zero".to_string(),
				));
			}
		}
		Ok(())
	}

	/// Validates output specifications
	fn validate_outputs(request: &GetQuoteRequest) -> Result<(), QuoteError> {
		for output in &request.requested_outputs {
			Self::validate_interop_address(&output.receiver)?;
			Self::validate_interop_address(&output.asset)?;

			if output.amount == U256::ZERO {
				return Err(QuoteError::InvalidRequest(
					"Output amount must be greater than zero".to_string(),
				));
			}
		}
		Ok(())
	}

	/// Validates an ERC-7930 interoperable address
	fn validate_interop_address(address: &InteropAddress) -> Result<(), QuoteError> {
		// Validate the interoperable address format
		address.validate().map_err(|e| {
			QuoteError::InvalidRequest(format!("Invalid interoperable address: {}", e))
		})?;

		// Additional validation could include:
		// - Chain-specific address validation
		// - Token contract existence checks
		// - Supported chain verification

		Ok(())
	}

	fn chain_id_from_interop(addr: &InteropAddress) -> Result<u64, QuoteError> {
		addr.ethereum_chain_id().map_err(|e| {
			QuoteError::InvalidRequest(format!("Invalid chain in interoperable address: {}", e))
		})
	}

    /// From the provided availableInputs, collect all assets that are supported by the solver.
    ///
    /// Returns Err if none are supported. Otherwise returns the subset to be used by later stages
    /// (e.g., balance checks, custody selection).
    pub fn collect_supported_available_inputs(
        request: &GetQuoteRequest,
        solver: &SolverEngine,
    ) -> Result<Vec<SupportedAsset>, QuoteError> {
        let networks = solver.token_manager().get_networks();
        let mut out: Vec<SupportedAsset> = Vec::new();

        for input in &request.available_inputs {
            let chain_id = Self::chain_id_from_interop(&input.asset)?;
            let evm_addr = match input.asset.ethereum_address() {
                Ok(a) => a,
                Err(e) => {
                    return Err(QuoteError::InvalidRequest(format!(
                        "Invalid input asset address: {}",
                        e
                    )))
                }
            };

            if let Some(net) = networks.get(&chain_id) {
                if net
                    .tokens
                    .iter()
                    .any(|t| t.address.0.as_slice() == evm_addr.as_slice())
                {
                    out.push(SupportedAsset {
                        chain_id,
                        evm_address: evm_addr,
                        interop: input.asset.clone(),
                        amount: input.amount,
                    });
                }
            }
        }

        if out.is_empty() {
            return Err(QuoteError::UnsupportedAsset(
                "None of the provided availableInputs are supported".to_string(),
            ));
        }

        Ok(out)
    }

    /// Validate that ALL requestedOutputs are supported, and return them in a structured form.
    pub fn validate_and_collect_requested_outputs(
        request: &GetQuoteRequest,
        solver: &SolverEngine,
    ) -> Result<Vec<SupportedAsset>, QuoteError> {
        let networks = solver.token_manager().get_networks();
        let mut out: Vec<SupportedAsset> = Vec::new();

        for output in &request.requested_outputs {
            let chain_id = Self::chain_id_from_interop(&output.asset)?;
            let evm_addr = match output.asset.ethereum_address() {
                Ok(a) => a,
                Err(e) => {
                    return Err(QuoteError::InvalidRequest(format!(
                        "Invalid output asset address: {}",
                        e
                    )))
                }
            };

            let supported = networks
                .get(&chain_id)
                .map(|net| net.tokens.iter().any(|t| t.address.0.as_slice() == evm_addr.as_slice()))
                .unwrap_or(false);

            if !supported {
                return Err(QuoteError::UnsupportedAsset(format!(
                    "Requested output token not supported on chain {}",
                    chain_id
                )));
            }

            out.push(SupportedAsset {
                chain_id,
                evm_address: evm_addr,
                interop: output.asset.clone(),
                amount: output.amount,
            });
        }

        Ok(out)
    }
}
