use alloy_primitives::keccak256;
use solver_types::{Address, NetworksConfig, QuoteDetails, Transaction};
use alloy_primitives::U256;

/// Build OutputSettler.fill(bytes32,bytes,bytes) with empty dynamic bytes for estimation.
pub fn build_dest_fill_tx(
    details: &QuoteDetails,
    dest_chain_id: u64,
    networks: &NetworksConfig,
) -> Option<Transaction> {
    let net = networks.get(&dest_chain_id)?;
    let to = net.output_settler_address.clone();

    // selector for fill(bytes32,bytes,bytes)
    let selector = &keccak256("fill(bytes32,bytes,bytes)".as_bytes())[0..4];

    let mut data = Vec::with_capacity(4 + 32 * 5);
    data.extend_from_slice(selector);
    // orderId: zero
    data.extend_from_slice(&[0u8; 32]);
    // offset originData: 0x60
    let mut off60 = [0u8; 32];
    off60[31] = 0x60;
    data.extend_from_slice(&off60);
    // offset fillerData: 0x80
    let mut off80 = [0u8; 32];
    off80[31] = 0x80;
    data.extend_from_slice(&off80);
    // originData length 0
    data.extend_from_slice(&[0u8; 32]);
    // fillerData length 0
    data.extend_from_slice(&[0u8; 32]);

    Some(Transaction {
        to: Some(Address(to.0.clone())),
        data,
        value: U256::ZERO,
        chain_id: dest_chain_id,
        nonce: None,
        gas_limit: None,
        gas_price: None,
        max_fee_per_gas: None,
        max_priority_fee_per_gas: None,
    })
}

/// Build InputSettlerEscrow.finalise(order,timestamps,solvers,destination,call) with minimal zero content.
/// This is used to estimate baseline claim gas on the origin chain.
pub fn build_origin_finalize_tx(
    _details: &QuoteDetails,
    origin_chain_id: u64,
    networks: &NetworksConfig,
) -> Option<Transaction> {
    // selector for finalise((...),uint32[],bytes32[],bytes32,bytes)
    let selector = &keccak256("finalise((address,uint256,uint256,uint32,uint32,address,uint256[2][],(bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes,bytes)[]),uint32[],bytes32[],bytes32,bytes)".as_bytes())[0..4];

    let net = networks.get(&origin_chain_id)?;
    let to = net.input_settler_address.clone();

    // ABI encoding with minimal empty/zero values, using correct dynamic offsets.
    // Layout: [selector][order][timestamps_off][solvers_off][destination][call_off][timestamps_data][solvers_data][call_data]
    // For simplicity, encode order as all zeros with empty arrays; destination bytes32 zero; timestamps/solvers empty arrays; call empty bytes.

    // Precompute sizes
    let head_size = 4 + 32 * 5; // selector + 5 head words after order tuple

    // Encode order tuple (static-sized fields plus dynamic arrays). We'll place it inline with all zeros and empty dynamic arrays.
    // Build order as per StandardOrder type: we fake minimal valid structure with zeros/empties. We only need estimateGas.
    let mut order_enc = Vec::new();
    // user
    order_enc.extend_from_slice(&[0u8; 32]);
    // nonce
    order_enc.extend_from_slice(&[0u8; 32]);
    // originChainId
    order_enc.extend_from_slice(&[0u8; 32]);
    // expires (uint32)
    order_enc.extend_from_slice(&[0u8; 32]);
    // fillDeadline (uint32)
    order_enc.extend_from_slice(&[0u8; 32]);
    // inputOracle (address)
    order_enc.extend_from_slice(&[0u8; 32]);
    // inputs offset (we’ll point to empty array right after the tuple)
    let inputs_offset_pos = order_enc.len();
    order_enc.extend_from_slice(&[0u8; 32]);
    // outputs offset
    let outputs_offset_pos = order_enc.len();
    order_enc.extend_from_slice(&[0u8; 32]);

    // After the 8 words of the tuple, place dynamic sections: inputs array (empty) then outputs array (empty).
    let tuple_head_len = order_enc.len();
    // inputs dynamic offset = tuple_head_len (relative to start of order)
    let inputs_offset = (tuple_head_len) as u64;
    let mut tmp = [0u8; 32];
    tmp[24..32].copy_from_slice(&inputs_offset.to_be_bytes());
    order_enc[inputs_offset_pos..inputs_offset_pos + 32].copy_from_slice(&tmp);
    // outputs dynamic offset = tuple_head_len + 32 (after inputs length word)
    let outputs_offset = (tuple_head_len + 32) as u64;
    let mut tmp2 = [0u8; 32];
    tmp2[24..32].copy_from_slice(&outputs_offset.to_be_bytes());
    order_enc[outputs_offset_pos..outputs_offset_pos + 32].copy_from_slice(&tmp2);
    // inputs length 0
    order_enc.extend_from_slice(&[0u8; 32]);
    // outputs length 0
    order_enc.extend_from_slice(&[0u8; 32]);

    // Now build the full call data head
    let mut data = Vec::with_capacity(4 + order_enc.len() + 32 * 5 + 32 * 3);
    data.extend_from_slice(selector);
    // order tuple inline
    data.extend_from_slice(&order_enc);
    // timestamps offset = head (selector + order + 5 words) in bytes
    let timestamps_offset = (data.len() - 4 + 32 * 5) as u64; // after we append the 5 head words below
    // We need to push 5 head words: timestamps_off, solvers_off, destination, call_off
    // We'll temporarily patch them after we determine exact positions. Simpler: compute from current sizes.

    // placeholders
    let ts_off_pos = data.len();
    data.extend_from_slice(&[0u8; 32]);
    let sol_off_pos = data.len();
    data.extend_from_slice(&[0u8; 32]);
    // destination bytes32 (zero)
    data.extend_from_slice(&[0u8; 32]);
    let call_off_pos = data.len();
    data.extend_from_slice(&[0u8; 32]);

    // Now append dynamic regions: timestamps (empty array), solvers (empty array), call (empty bytes)
    let ts_start = data.len();
    data.extend_from_slice(&[0u8; 32]); // timestamps length 0
    let sol_start = data.len();
    data.extend_from_slice(&[0u8; 32]); // solvers length 0
    let call_start = data.len();
    data.extend_from_slice(&[0u8; 32]); // call length 0

    // patch offsets (relative to start of head after selector+order)
    let base_after_order = (4 + order_enc.len()) as u64;
    let ts_off = base_after_order + ((ts_off_pos - (4 + order_enc.len())) as u64) + 32 * 4; // to ts_start
    let sol_off = base_after_order + ((sol_off_pos - (4 + order_enc.len())) as u64) + 32 * 4 + 32; // to sol_start
    let call_off = base_after_order + ((call_off_pos - (4 + order_enc.len())) as u64) + 32 * 4 + 32 + 32; // to call_start

    let mut word = [0u8; 32];
    // timestamps offset
    word[24..32].copy_from_slice(&((ts_start - (4 + order_enc.len())) as u64).to_be_bytes());
    data[ts_off_pos..ts_off_pos + 32].copy_from_slice(&word);
    // solvers offset
    word = [0u8; 32];
    word[24..32].copy_from_slice(&((sol_start - (4 + order_enc.len())) as u64).to_be_bytes());
    data[sol_off_pos..sol_off_pos + 32].copy_from_slice(&word);
    // call offset
    word = [0u8; 32];
    word[24..32].copy_from_slice(&((call_start - (4 + order_enc.len())) as u64).to_be_bytes());
    data[call_off_pos..call_off_pos + 32].copy_from_slice(&word);

    Some(Transaction {
        to: Some(Address(to.0.clone())),
        data,
        value: U256::ZERO,
        chain_id: origin_chain_id,
        nonce: None,
        gas_limit: None,
        gas_price: None,
        max_fee_per_gas: None,
        max_priority_fee_per_gas: None,
    })
}

