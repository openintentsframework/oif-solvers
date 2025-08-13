//! Quote capability checks (balances, gas, etc.)
//!
//! This module hosts runtime capability checks that the solver must pass
//! before generating a quote, such as ensuring sufficient token balances
//! on destination chains.

use alloy_primitives::{hex, U256};
use solver_core::SolverEngine;
use solver_types::{Address as SolverAddress, QuoteError};

use super::validation::SupportedAsset;

/// Ensure the solver has enough balance for all requested destination outputs.
///
/// For each output token, queries the current solver balance via TokenManager
/// and verifies it is greater than or equal to the requested amount.
pub async fn ensure_destination_balances(
    solver: &SolverEngine,
    outputs: &[SupportedAsset],
) -> Result<(), QuoteError> {
    let token_manager = solver.token_manager();

    for out in outputs {
        // Build solver-types Address from alloy address bytes
        let token_addr = SolverAddress(out.evm_address.as_slice().to_vec());

        let balance_str = token_manager
            .check_balance(out.chain_id, &token_addr)
            .await
            .map_err(|e| QuoteError::Internal(format!("Balance check failed: {}", e)))?;

        let balance = U256::from_str_radix(&balance_str, 10)
            .map_err(|e| QuoteError::Internal(format!("Failed to parse balance: {}", e)))?;

        if balance < out.amount {
            tracing::info!(
                chain_id = out.chain_id,
                required = %out.amount,
                available = %balance,
                token = %format!("0x{}", hex::encode(out.evm_address.as_slice())),
                "Insufficient destination balance"
            );
            return Err(QuoteError::InsufficientLiquidity);
        } else {
            tracing::debug!(
                chain_id = out.chain_id,
                required = %out.amount,
                available = %balance,
                token = %format!("0x{}", hex::encode(out.evm_address.as_slice())),
                "Sufficient destination balance"
            );
        }
    }

    Ok(())
}

