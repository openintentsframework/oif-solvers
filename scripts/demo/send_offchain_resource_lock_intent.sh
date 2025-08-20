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

# Extract RPC URLs (supports both rpc_url and [[rpc_urls]] formats)
ORIGIN_RPC_URL=$(sed -n "/\\[\\[networks.$ORIGIN_CHAIN_ID.rpc_urls\\]\\]/,/^\\[/p" $NETWORKS_CONFIG | grep -E '^[[:space:]]*http[[:space:]]*=' | head -1 | cut -d'"' -f2)
DEST_RPC_URL=$(sed -n "/\\[\\[networks.$DEST_CHAIN_ID.rpc_urls\\]\\]/,/^\\[/p" $NETWORKS_CONFIG | grep -E '^[[:space:]]*http[[:space:]]*=' | head -1 | cut -d'"' -f2)
if [ -z "$ORIGIN_RPC_URL" ]; then
  ORIGIN_RPC_URL=$(grep -A 2 "\\[networks.$ORIGIN_CHAIN_ID\\]" $NETWORKS_CONFIG | grep 'rpc_url[[:space:]]*=' | cut -d'"' -f2)
fi
if [ -z "$DEST_RPC_URL" ]; then
  DEST_RPC_URL=$(grep -A 2 "\\[networks.$DEST_CHAIN_ID\\]" $NETWORKS_CONFIG | grep 'rpc_url[[:space:]]*=' | cut -d'"' -f2)
fi
# Fallback defaults
if [ -z "$ORIGIN_RPC_URL" ]; then ORIGIN_RPC_URL="http://localhost:8545"; fi
if [ -z "$DEST_RPC_URL" ]; then DEST_RPC_URL="http://localhost:8546"; fi

ORIGIN_CHAIN_ID=31337
DEST_CHAIN_ID=31338

ORIGIN_TOKEN_ADDRESS=${1:-$DEFAULT_ORIGIN_TOKEN}
DEST_TOKEN_ADDRESS=${2:-$DEFAULT_DEST_TOKEN}

API_URL=${3:-"http://localhost:3000/api/orders"}

AMOUNT="1000000000000000000" # 1e18

# Build StandardOrder bytes (same as escrow script but used for Compact witness)
CURRENT_TIME=$(date +%s)
NONCE=$(perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000')
FILL_DEADLINE=$((CURRENT_TIME + 7200))  # 2 hours
EXPIRY=$((CURRENT_TIME + 7200))  # 2 hours

# Convert origin token address to uint256 for inputs (uint256[2][]) field  
ORIGIN_TOKEN_U256=$(cast to-dec "$ORIGIN_TOKEN_ADDRESS")

# Build bytes32 representations using left-padding (matches normalize_bytes32_address)
ZERO_BYTES32="0x0000000000000000000000000000000000000000000000000000000000000000"
OUTPUT_SETTLER_BYTES32="0x000000000000000000000000$(echo $OUTPUT_SETTLER_ADDRESS | cut -c3-)"
DEST_TOKEN_BYTES32="0x000000000000000000000000$(echo $DEST_TOKEN_ADDRESS | cut -c3-)" 
RECIPIENT_BYTES32="0x000000000000000000000000$(echo $RECIPIENT_ADDR | cut -c3-)"

STANDARD_ORDER_ABI_TYPE='f((address,uint256,uint256,uint32,uint32,address,uint256[2][],(bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes,bytes)[]))'

# For demo, use precomputed TOKEN_ID_HEX from setup, or compute it
if [ -z "$TOKEN_ID_HEX" ]; then
  echo -e "${YELLOW}⚠️  TOKEN_ID_HEX not found in compact.env${NC}"
  echo -e "${YELLOW}   Computing from lockTag and token address...${NC}"
  
  # Compute TOKEN_ID from lockTag and token address (lockTag || token)
  TOKEN_ID_HEX=0x$(echo $LOCKTAG_HEX | cut -c3-)$(echo $ORIGIN_TOKEN_ADDRESS | cut -c3-)
  echo -e "${GREEN}✅ Computed resource lock ID: $TOKEN_ID_HEX${NC}"
  echo -e "${BLUE}   Note: This assumes allocator was registered during setup${NC}"
fi
TOKEN_ID_U256=$(cast to-dec $TOKEN_ID_HEX)

# Check if user has sufficient balance in TheCompact for this resource lock
echo -e "${BLUE}💰 Checking TheCompact balance...${NC}"
COMPACT_BALANCE=$(cast call $THE_COMPACT "balanceOf(address,uint256)" $USER_ADDR $TOKEN_ID_U256 --rpc-url $ORIGIN_RPC_URL)
COMPACT_BALANCE_DEC=$(cast to-dec $COMPACT_BALANCE 2>/dev/null || echo "0")
REQUIRED_AMOUNT=$AMOUNT

echo -e "   User balance in TheCompact: $(echo "scale=2; $COMPACT_BALANCE_DEC / 1000000000000000000" | bc -l) tokens"
echo -e "   Required for order: $(echo "scale=2; $REQUIRED_AMOUNT / 1000000000000000000" | bc -l) tokens"

# Use bc for large number comparison
if [ $(echo "$COMPACT_BALANCE_DEC < $REQUIRED_AMOUNT" | bc) -eq 1 ]; then
  echo -e "${YELLOW}⚠️  Insufficient balance in TheCompact, depositing tokens...${NC}"
  
  DEPOSIT_AMOUNT=$((REQUIRED_AMOUNT * 5))  # Deposit 5x the required amount
  
  # Approve TheCompact to spend user tokens
  echo -e "${BLUE}   Approving TheCompact to spend tokens...${NC}"
  cast send $ORIGIN_TOKEN_ADDRESS "approve(address,uint256)" $THE_COMPACT $DEPOSIT_AMOUNT \
    --rpc-url $ORIGIN_RPC_URL \
    --private-key $USER_PRIVATE_KEY > /dev/null
  
  # Deposit tokens into TheCompact
  echo -e "${BLUE}   Depositing $(echo "scale=1; $DEPOSIT_AMOUNT / 1000000000000000000" | bc -l) tokens into TheCompact...${NC}"
  DEPOSIT_TX=$(cast send $THE_COMPACT "depositERC20(address,bytes12,uint256,address)" \
    $ORIGIN_TOKEN_ADDRESS $LOCKTAG_HEX $DEPOSIT_AMOUNT $USER_ADDR \
    --rpc-url $ORIGIN_RPC_URL \
    --private-key $USER_PRIVATE_KEY 2>&1)
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to deposit tokens into TheCompact${NC}"
    echo "$DEPOSIT_TX"
    exit 1
  fi
  
  # Verify the new balance
  NEW_BALANCE=$(cast call $THE_COMPACT "balanceOf(address,uint256)" $USER_ADDR $TOKEN_ID_U256 --rpc-url $ORIGIN_RPC_URL)
  NEW_BALANCE_DEC=$(cast to-dec $NEW_BALANCE 2>/dev/null || echo "0")
  echo -e "${GREEN}✅ New balance: $(echo "scale=2; $NEW_BALANCE_DEC / 1000000000000000000" | bc -l) tokens${NC}"
else
  echo -e "${GREEN}✅ Sufficient balance available${NC}"
fi

# Build commitments hash using getLockHash approach from test (line 124-146)
# Extract lockTag and token from TOKEN_ID as the test does
EXTRACTED_LOCKTAG="0x$(echo $TOKEN_ID_HEX | cut -c3-26)"  # First 12 bytes (24 hex chars)
EXTRACTED_TOKEN="0x$(echo $TOKEN_ID_HEX | cut -c27-66)"   # Last 20 bytes (40 hex chars)

# Compute lock hash exactly like the test's getLockHash function
LOCK_TYPE_HASH=$(cast keccak "Lock(bytes12 lockTag,address token,uint256 amount)")
LOCK_HASH=$(cast keccak $(cast abi-encode "f(bytes32,bytes12,address,uint256)" "$LOCK_TYPE_HASH" "$EXTRACTED_LOCKTAG" "$EXTRACTED_TOKEN" "$AMOUNT"))
COMMITMENTS_HASH=$(cast keccak "$LOCK_HASH")

# Commitments computed successfully

ORDER_DATA=$(cast abi-encode "$STANDARD_ORDER_ABI_TYPE" \
  "(${USER_ADDR},${NONCE},${ORIGIN_CHAIN_ID},${EXPIRY},${FILL_DEADLINE},${ORACLE_ADDRESS},[[${TOKEN_ID_U256},${AMOUNT}]],[(${ZERO_BYTES32},${OUTPUT_SETTLER_BYTES32},${DEST_CHAIN_ID},${DEST_TOKEN_BYTES32},${AMOUNT},${RECIPIENT_BYTES32},0x,0x)])")

echo -e "${BLUE}📋 Order Details (Compact):${NC}"
echo -e "   Origin Token: $ORIGIN_TOKEN_ADDRESS"
echo -e "   Dest Token:   $DEST_TOKEN_ADDRESS"
echo -e "   TheCompact:   $THE_COMPACT"
echo -e "   InputSettlerCompact: $INPUT_SETTLER_COMPACT"

# Build Compact signatures payload
# We need: sponsorSignature over BatchCompact type and optional allocatorData (empty for demo)

# Compute witness hash manually using the exact same logic as StandardOrderType.witnessHash
MANDATE_TYPE_HASH=$(cast keccak "Mandate(uint32 fillDeadline,address inputOracle,MandateOutput[] outputs)MandateOutput(bytes32 oracle,bytes32 settler,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes call,bytes context)")
MANDATE_OUTPUT_TYPE_HASH=$(cast keccak "MandateOutput(bytes32 oracle,bytes32 settler,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes call,bytes context)")

# Compute individual output hash (matches MandateOutputType.hashOutput)
OUTPUT_HASH=$(cast keccak $(cast abi-encode "f(bytes32,bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes32,bytes32)" \
  "$MANDATE_OUTPUT_TYPE_HASH" "$ZERO_BYTES32" "$OUTPUT_SETTLER_BYTES32" "$DEST_CHAIN_ID" "$DEST_TOKEN_BYTES32" "$AMOUNT" "$RECIPIENT_BYTES32" \
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"))

# Compute outputs hash (matches MandateOutputType.hashOutputs - just hash the single output hash)
OUTPUTS_HASH=$(cast keccak "$OUTPUT_HASH")

# Compute witness hash (matches StandardOrderType.witnessHash)
WITNESS_HASH=$(cast keccak $(cast abi-encode "f(bytes32,uint32,address,bytes32)" "$MANDATE_TYPE_HASH" "$FILL_DEADLINE" "$ORACLE_ADDRESS" "$OUTPUTS_HASH"))

# Witness hash computed using contract function

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

# Prefix signatures: for Compact we send abi.encode(sponsorSig, allocatorData) as-is (no type prefix)
SIG_BYTES=$(cast abi-encode "f(bytes,bytes)" "$SPONSOR_SIG" "$ALLOCATOR_DATA")
COMPACT_SIGNATURE="$SIG_BYTES"

JSON_PAYLOAD=$(cat <<EOF
{
  "order": "$ORDER_DATA",
  "sponsor": "$USER_ADDR",
  "signature": "$COMPACT_SIGNATURE",
  "lock_type": 3
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

