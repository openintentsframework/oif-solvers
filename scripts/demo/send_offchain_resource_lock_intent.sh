#!/bin/bash
# Send an off-chain cross-chain intent using Resource Lock (The Compact)
# This script mirrors send_offchain_intent.sh but builds Compact signatures
# and sets a special 0x02 prefix to indicate Compact flow to the solver.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}📤 Sending EIP-7683 Intent via Resource Lock (The Compact)${NC}"
echo "========================================="

if [ ! -f "config/demo.toml" ] || [ ! -f "config/demo/networks.toml" ]; then
  echo -e "${RED}❌ Configuration not found!${NC}"
  echo -e "${YELLOW}💡 Run './scripts/demo/setup_local_anvil.sh' first${NC}"
  exit 1
fi

MAIN_CONFIG="config/demo.toml"
NETWORKS_CONFIG="config/demo/networks.toml"

# Load addresses
INPUT_SETTLER_COMPACT=$(grep -A 5 '\[networks.31337\]' $NETWORKS_CONFIG | grep 'input_settler_compact_address = ' | cut -d'"' -f2)
THE_COMPACT=$(grep -A 5 '\[networks.31337\]' $NETWORKS_CONFIG | grep 'the_compact_address = ' | cut -d'"' -f2)
OUTPUT_SETTLER_ADDRESS=$(grep -A 5 '\[networks.31338\]' $NETWORKS_CONFIG | grep 'output_settler_address = ' | cut -d'"' -f2)

# Optional: precomputed Compact params from setup
if [ -f "config/demo/compact.env" ]; then
  # shellcheck disable=SC1091
  source config/demo/compact.env
fi
# Fallbacks if not set
LOCKTAG_HEX=${LOCKTAG_HEX:-"0x000000000000000000000000"}
# TOKEN_ID_HEX if not provided will be constructed with zero lockTag and origin token

ORACLE_ADDRESS=$(grep 'oracle_addresses = ' $MAIN_CONFIG | sed 's/.*31337 = "\([^"]*\)".*/\1/')

DEFAULT_ORIGIN_TOKEN=$(awk '/\[\[networks.31337.tokens\]\]/{f=1} f && /address =/{gsub(/"/, "", $3); print $3; exit}' $NETWORKS_CONFIG)
DEFAULT_DEST_TOKEN=$(awk '/\[\[networks.31338.tokens\]\]/{f=1} f && /address =/{gsub(/"/, "", $3); print $3; exit}' $NETWORKS_CONFIG)

SOLVER_ADDR=$(grep -A 4 '\[accounts\]' $MAIN_CONFIG | grep 'solver = ' | cut -d'"' -f2)
USER_ADDR=$(grep -A 4 '\[accounts\]' $MAIN_CONFIG | grep 'user = ' | cut -d'"' -f2)
USER_PRIVATE_KEY=$(grep -A 4 '\[accounts\]' $MAIN_CONFIG | grep 'user_private_key = ' | cut -d'"' -f2)
RECIPIENT_ADDR=$(grep -A 4 '\[accounts\]' $MAIN_CONFIG | grep 'recipient = ' | cut -d'"' -f2)

ORIGIN_RPC_URL=$(grep -A 2 '\[networks.31337\]' $NETWORKS_CONFIG | grep 'rpc_url = ' | cut -d'"' -f2)
DEST_RPC_URL=$(grep -A 2 '\[networks.31338\]' $NETWORKS_CONFIG | grep 'rpc_url = ' | cut -d'"' -f2)
ORIGIN_CHAIN_ID=31337
DEST_CHAIN_ID=31338

ORIGIN_TOKEN_ADDRESS=${1:-$DEFAULT_ORIGIN_TOKEN}
DEST_TOKEN_ADDRESS=${2:-$DEFAULT_DEST_TOKEN}

API_URL=${3:-"http://localhost:3000/api/orders"}

AMOUNT="1000000000000000000" # 1e18

# Build StandardOrder bytes (same as escrow script but used for Compact witness)
CURRENT_TIME=$(date +%s)
NONCE=$(perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000')
FILL_DEADLINE=$((CURRENT_TIME + 3600))
EXPIRY=$FILL_DEADLINE

# Convert origin token address to uint256 for inputs (uint256[2][]) field
ORIGIN_TOKEN_U256=$(cast to-dec $ORIGIN_TOKEN_ADDRESS)

# Build bytes32 representations via cast to avoid length issues
ZERO_BYTES32="0x0000000000000000000000000000000000000000000000000000000000000000"
OUTPUT_SETTLER_BYTES32=$(cast to-bytes32 $OUTPUT_SETTLER_ADDRESS)
DEST_TOKEN_BYTES32=$(cast to-bytes32 $DEST_TOKEN_ADDRESS)
RECIPIENT_BYTES32=$(cast to-bytes32 $RECIPIENT_ADDR)

STANDARD_ORDER_ABI_TYPE='f((address,uint256,uint256,uint32,uint32,address,uint256[2][],(bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes,bytes)[]))'

# For demo, use precomputed TOKEN_ID_HEX if available, else synthetic from zero lockTag
if [ -z "$TOKEN_ID_HEX" ]; then
  TOKEN_ID_HEX=$(printf "0x%024x%s" 0 "${ORIGIN_TOKEN_ADDRESS:2}")
fi
TOKEN_ID_U256=$(cast to-dec $TOKEN_ID_HEX)
LOCK_TYPE_HASH=$(cast keccak "Lock(bytes12 lockTag,address token,uint256 amount)")
LOCK_HASH=$(cast keccak $(cast abi-encode "f(bytes32,bytes12,address,uint256)" "$LOCK_TYPE_HASH" "$LOCKTAG_HEX" "$ORIGIN_TOKEN_ADDRESS" "$AMOUNT"))
COMMITMENTS_HASH=$(cast keccak "$LOCK_HASH")

ORDER_DATA=$(cast abi-encode "$STANDARD_ORDER_ABI_TYPE" \
  "(${USER_ADDR},${NONCE},${ORIGIN_CHAIN_ID},${EXPIRY},${FILL_DEADLINE},${ORACLE_ADDRESS},[[${TOKEN_ID_U256},${AMOUNT}]],[(${ZERO_BYTES32},${OUTPUT_SETTLER_BYTES32},${DEST_CHAIN_ID},${DEST_TOKEN_BYTES32},${AMOUNT},${RECIPIENT_BYTES32},0x,0x)])")

echo -e "${BLUE}📋 Order Details (Compact):${NC}"
echo -e "   Origin Token: $ORIGIN_TOKEN_ADDRESS"
echo -e "   Dest Token:   $DEST_TOKEN_ADDRESS"
echo -e "   TheCompact:   $THE_COMPACT"
echo -e "   InputSettlerCompact: $INPUT_SETTLER_COMPACT"

# Build Compact signatures payload
# We need: sponsorSignature over BatchCompact type and optional allocatorData (empty for demo)

# Compute witness hash (matches InputSettlerCompact.StandardOrderType.witnessHash)
MANDATE_TYPE_HASH=$(cast keccak "Mandate(uint32 fillDeadline,address inputOracle,MandateOutput[] outputs)MandateOutput(bytes32 oracle,bytes32 settler,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes call,bytes context)")
MANDATE_OUTPUT_TYPE_HASH=$(cast keccak "MandateOutput(bytes32 oracle,bytes32 settler,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes call,bytes context)")

OUTPUT_HASH=$(cast keccak $(cast abi-encode "f(bytes32,bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes32,bytes32)" \
  "$MANDATE_OUTPUT_TYPE_HASH" "$ZERO_BYTES32" "$OUTPUT_SETTLER_BYTES32" "$DEST_CHAIN_ID" "$DEST_TOKEN_BYTES32" "$AMOUNT" "$RECIPIENT_BYTES32" \
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"))
OUTPUTS_HASH=$(cast keccak "$OUTPUT_HASH")

WITNESS_HASH=$(cast keccak $(cast abi-encode "f(bytes32,uint32,address,bytes32)" "$MANDATE_TYPE_HASH" "$FILL_DEADLINE" "$ORACLE_ADDRESS" "$OUTPUTS_HASH"))

# Build BatchCompact EIP-712 digest using TheCompact DOMAIN_SEPARATOR
DOMAIN_SEPARATOR=$(cast call $THE_COMPACT "DOMAIN_SEPARATOR()" --rpc-url $ORIGIN_RPC_URL)

BATCH_COMPACT_TYPE_HASH=$(cast keccak "BatchCompact(address arbiter,address sponsor,uint256 nonce,uint256 expires,Lock[] commitments,Mandate mandate)Lock(bytes12 lockTag,address token,uint256 amount)Mandate(uint32 fillDeadline,address inputOracle,MandateOutput[] outputs)MandateOutput(bytes32 oracle,bytes32 settler,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes call,bytes context)")

INNER_STRUCT_HASH=$(cast keccak $(cast abi-encode "f(bytes32,address,address,uint256,uint256,bytes32,bytes32)" \
  "$BATCH_COMPACT_TYPE_HASH" "$INPUT_SETTLER_COMPACT" "$USER_ADDR" "$NONCE" "$EXPIRY" "$COMMITMENTS_HASH" "$WITNESS_HASH"))

FINAL_DIGEST=$(cast keccak "0x1901${DOMAIN_SEPARATOR:2}${INNER_STRUCT_HASH:2}")

echo -e "${BLUE}🔏 Signing Compact sponsor signature...${NC}"
SPONSOR_SIG=$(cast wallet sign --no-hash --private-key "$USER_PRIVATE_KEY" "$FINAL_DIGEST")
echo -e "${GREEN}✅ Sponsor signature: $SPONSOR_SIG${NC}"

# For demo, no allocat0xd93f642f64180aor data (empty bytes)
ALLOCATOR_DATA="0x"

# Prefix signatures with 0x02 to signal Compact flow; payload is abi.encode(sponsorSig, allocatorData)
SIG_BYTES=$(cast abi-encode "f(bytes,bytes)" "$SPONSOR_SIG" "$ALLOCATOR_DATA")
PREFIXED_SIGNATURE="0x02${SIG_BYTES:2}"

JSON_PAYLOAD=$(cat <<EOF
{
  "order": "$ORDER_DATA",
  "sponsor": "$USER_ADDR",
  "signature": "$PREFIXED_SIGNATURE"
}
EOF
)

echo -e "${YELLOW}🚀 Sending order to API...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" -H "Content-Type: application/json" -d "$JSON_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ Order submitted successfully!${NC}"
  echo -e "   Response: $RESPONSE_BODY"
else
  echo -e "${RED}❌ Failed to submit order${NC}"
  echo -e "   HTTP Status: $HTTP_CODE"
  echo -e "   Response: $RESPONSE_BODY"
  exit 1
fi

