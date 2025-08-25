//! Utility functions for common type conversions and transformations.
//!
//! This module provides helper functions for converting between different
//! data formats and string formatting commonly used throughout the solver system.

pub mod constants;
pub mod conversion;
pub mod eip712;
pub mod formatting;
pub mod helpers;

pub use constants::ZERO_BYTES32;
pub use conversion::{bytes20_to_alloy_address, bytes32_to_address, parse_address};
pub use eip712::{
	compute_domain_hash, compute_final_digest, Eip712AbiEncoder, DOMAIN_TYPE, MANDATE_OUTPUT_TYPE,
	NAME_PERMIT2, PERMIT2_WITNESS_TYPE, PERMIT_BATCH_WITNESS_TYPE, TOKEN_PERMISSIONS_TYPE,
};
pub use formatting::{format_token_amount, truncate_id, with_0x_prefix, without_0x_prefix};
pub use helpers::current_timestamp;

use alloy_primitives::{Address, U256};

/// Produce nicely formatted, per-line strings describing a StandardOrder-like payload.
///
/// This avoids depending on the concrete type by accepting primitive fields only.
pub fn format_standard_order_lines(
	user: Address,
	nonce: U256,
	origin_chain_id: U256,
	expires: u32,
	fill_deadline: u32,
	input_oracle: Address,
	inputs: &[[U256; 2]],
	first_output: Option<(
		[u8; 32],
		[u8; 32],
		U256,
		[u8; 32],
		U256,
		[u8; 32],
		usize,
		usize,
	)>,
) -> Vec<String> {
	let mut lines = Vec::new();
	lines.push("Parsed order".to_string());
	lines.push(format!("user: {}", with_0x_prefix(&hex::encode(user))));
	lines.push(format!("nonce: {}", nonce));
	lines.push(format!("origin_chain_id: {}", origin_chain_id));
	lines.push(format!("expires: {}", expires));
	lines.push(format!("fill_deadline: {}", fill_deadline));
	lines.push(format!(
		"input_oracle: {}",
		with_0x_prefix(&hex::encode(input_oracle))
	));
	lines.push(format!("inputs_len: {}", inputs.len()));
	lines.push(format!(
		"outputs_len: {}",
		if first_output.is_some() { 1 } else { 0 }
	));

	if let Some((oracle, settler, chain_id, token, amount, recipient, call_len, context_len)) =
		first_output
	{
		// First input (if available) for symmetry with output
		if let Some(first_input) = inputs.get(0) {
			let token_hex = format!("{:#x}", first_input[0]);
			let amount_dec = first_input[1].to_string();
			lines.push(format!("first_input_token: {}", token_hex));
			lines.push(format!("first_input_amount: {}", amount_dec));
		}

		lines.push(format!(
			"first_output_oracle: {}",
			with_0x_prefix(&hex::encode(oracle))
		));
		lines.push(format!(
			"first_output_settler: {}",
			with_0x_prefix(&hex::encode(settler))
		));
		lines.push(format!("first_output_chain_id: {}", chain_id));
		lines.push(format!(
			"first_output_token: {}",
			with_0x_prefix(&hex::encode(token))
		));
		lines.push(format!("first_output_amount: {}", amount));
		lines.push(format!(
			"first_output_recipient: {}",
			with_0x_prefix(&hex::encode(recipient))
		));
		lines.push(format!("first_output_call_len: {}", call_len));
		lines.push(format!("first_output_context_len: {}", context_len));
	} else if let Some(first_input) = inputs.get(0) {
		// If no output provided, still include first input if present
		let token_hex = format!("{:#x}", first_input[0]);
		let amount_dec = first_input[1].to_string();
		lines.push(format!("first_input_token: {}", token_hex));
		lines.push(format!("first_input_amount: {}", amount_dec));
	}

	lines
}

/// Normalize a bytes32 that is expected to embed an `address` into
/// a canonical left-padded form: 12 zero bytes followed by 20 address bytes.
///
/// If the input looks right-padded (address in the first 20 bytes and 12 zero
/// bytes at the end), it will be converted to left-padded. Otherwise it is
/// returned unchanged.
pub fn normalize_bytes32_address(bytes32_value: [u8; 32]) -> [u8; 32] {
	// Detect right-padded shape: [address(20)][zeros(12)]
	let is_trailing_zeros = bytes32_value[20..32].iter().all(|&b| b == 0);
	let has_nonzero_prefix = bytes32_value[0..20].iter().any(|&b| b != 0);
	if is_trailing_zeros && has_nonzero_prefix {
		let mut normalized = [0u8; 32];
		normalized[12..32].copy_from_slice(&bytes32_value[0..20]);
		normalized
	} else {
		bytes32_value
	}
}
