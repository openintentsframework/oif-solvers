//! Utility functions for common type conversions and transformations.
//!
//! This module provides helper functions for converting between different
//! data formats and string formatting commonly used throughout the solver system.

pub mod conversion;
pub mod eip712_utils;
pub mod formatting;

pub use conversion::bytes32_to_address;
pub use eip712_utils::{compute_domain_hash, compute_final_digest, Eip712AbiEncoder};
pub use formatting::{format_token_amount, truncate_id, with_0x_prefix, without_0x_prefix};
