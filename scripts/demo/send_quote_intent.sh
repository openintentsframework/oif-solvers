#!/usr/bin/env bash

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_BASE="${1:-http://127.0.0.1:3000}"
QUOTE_ENDPOINT="$API_BASE/api/quotes"
ORDERS_ENDPOINT="$API_BASE/api/orders"

echo -e "${BLUE}🎯 Requesting quote and submitting signed intent${NC}"
echo -e "${YELLOW}API:${NC} $API_BASE"

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo -e "${RED}$1 not found${NC}"; exit 1; }; }
need_cmd jq
need_cmd curl

if [ ! -f "config/demo.toml" ]; then
  echo -e "${RED}Missing config/demo.toml${NC}"; exit 1
fi

# Parse config values
ORIGIN_CHAIN_ID=31337
DEST_CHAIN_ID=31338

USER_ADDR=$(grep -A 4 '\[accounts\]' config/demo.toml | grep 'user = ' | head -1 | cut -d'"' -f2)
RECIPIENT_ADDR=$(grep -A 4 '\[accounts\]' config/demo.toml | grep 'recipient = ' | head -1 | cut -d'"' -f2)

TOKENA_ORIGIN=$(awk '/\[\[networks.31337.tokens\]\]/{f=1} f && /address =/{gsub(/"/, "", $3); print $3; exit}' config/demo/networks.toml)
TOKENA_DEST=$(awk '/\[\[networks.31338.tokens\]\]/{f=1} f && /address =/{gsub(/"/, "", $3); print $3; exit}' config/demo/networks.toml)

# Build ERC-7930 interop addresses (UII) for demo chains
to_uii() {
  local chain_id="$1"; local evm_addr="$2"
  local chain_ref=""
  if [ "$chain_id" = "31337" ]; then chain_ref="7a69"; fi
  if [ "$chain_id" = "31338" ]; then chain_ref="7a6a"; fi
  local clean_addr=$(echo "$evm_addr" | sed 's/^0x//')
  echo "0x0100000214${chain_ref}${clean_addr}"
}

USER_UII_ORIGIN=$(to_uii $ORIGIN_CHAIN_ID $USER_ADDR)
RECIPIENT_UII_DEST=$(to_uii $DEST_CHAIN_ID $RECIPIENT_ADDR)
TOKENA_UII_ORIGIN=$(to_uii $ORIGIN_CHAIN_ID $TOKENA_ORIGIN)
TOKENA_UII_DEST=$(to_uii $DEST_CHAIN_ID $TOKENA_DEST)

ONE="1000000000000000000"

# Define variables needed for approve_permit2 function
ORIGIN_TOKEN_ADDRESS="$TOKENA_ORIGIN"
ORIGIN_RPC_URL="http://localhost:8545"
USER_PRIVATE_KEY=$(grep -A 4 '\[accounts\]' config/demo.toml | grep 'user_private_key = ' | head -1 | cut -d'"' -f2)

# Approve tokens for Permit2
approve_permit2() {
    local PERMIT2_ADDRESS="0x000000000022D473030F116dDEE9F6B43aC78BA3"
    
    echo -e "${BLUE}🔐 Checking Permit2 allowance...${NC}"
    
    CURRENT_ALLOWANCE=$(cast call "$ORIGIN_TOKEN_ADDRESS" \
        "allowance(address,address)" \
        "$USER_ADDR" \
        "$PERMIT2_ADDRESS" \
        --rpc-url $ORIGIN_RPC_URL)
    
    if [ "$CURRENT_ALLOWANCE" = "0x0000000000000000000000000000000000000000000000000000000000000000" ]; then
        echo -e "${BLUE}   Approving Permit2...${NC}"
        
        TX_HASH=$(cast send "$ORIGIN_TOKEN_ADDRESS" \
            "approve(address,uint256)" \
            "$PERMIT2_ADDRESS" \
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" \
            --private-key "$USER_PRIVATE_KEY" \
            --rpc-url $ORIGIN_RPC_URL \
            --json | jq -r '.transactionHash')
        
        echo -e "${GREEN}✅ Permit2 approved${NC}"
    else
        echo -e "${GREEN}✅ Sufficient allowance already exists${NC}"
    fi
}

# Approve Permit2 if needed
approve_permit2

# Function to display formatted quote summary
display_quote_summary() {
  local quote_json="$1"
  
  echo -e "${BLUE}📊 Quote Summary${NC}"
  echo "================="
  
  # Extract quote details
  local quote_id=$(echo "$quote_json" | jq -r '.quotes[0].quoteId')
  local valid_until=$(echo "$quote_json" | jq -r '.quotes[0].validUntil')
  local orders_count=$(echo "$quote_json" | jq -r '.quotes[0].orders | length')
  
  # Format timestamp
  local valid_until_formatted=$(date -r "$valid_until" 2>/dev/null || date -d "@$valid_until" 2>/dev/null || echo "$valid_until")
  
  # Extract cost breakdown if available
  local total_cost=$(echo "$quote_json" | jq -r '.quotes[0].cost.total // "N/A"')
  local gas_cost=$(echo "$quote_json" | jq -r '.quotes[0].cost.gas // "N/A"')
  local commission=$(echo "$quote_json" | jq -r '.quotes[0].cost.commission // "N/A"')
  local subtotal=$(echo "$quote_json" | jq -r '.quotes[0].cost.subtotal // "N/A"')
  
  echo -e "${GREEN}Quote ID:${NC}     $quote_id"
  echo -e "${GREEN}Valid Until:${NC}  $valid_until_formatted"
  echo -e "${GREEN}Orders:${NC}       $orders_count"
  
  # Format costs in ETH (divide by 1e18)
  if [ "$total_cost" != "N/A" ]; then
    local total_eth=$(echo "scale=6; $total_cost / 1000000000000000000" | bc -l 2>/dev/null || echo "$total_cost")
    echo -e "${GREEN}Total Cost:${NC}   ${total_eth} ETH (${total_cost} wei)"
    
    if [ "$subtotal" != "N/A" ]; then
      local subtotal_eth=$(echo "scale=6; $subtotal / 1000000000000000000" | bc -l 2>/dev/null || echo "$subtotal")
      echo -e "${GREEN}Subtotal:${NC}     ${subtotal_eth} ETH"
    fi
    
    if [ "$gas_cost" != "N/A" ]; then
      local gas_eth=$(echo "scale=6; $gas_cost / 1000000000000000000" | bc -l 2>/dev/null || echo "$gas_cost")
      echo -e "${GREEN}Gas Cost:${NC}     ${gas_eth} ETH"
    fi
    
    if [ "$commission" != "N/A" ]; then
      local commission_eth=$(echo "scale=6; $commission / 1000000000000000000" | bc -l 2>/dev/null || echo "$commission")
      echo -e "${GREEN}Commission:${NC}   ${commission_eth} ETH"
    fi
  fi
  
  # Extract route information
  echo ""
  echo -e "${BLUE}📍 Route Details${NC}"
  echo "================="
  echo -e "${GREEN}Input:${NC}        1.0 TOKA (Chain 31337)"
  echo -e "${GREEN}Output:${NC}       1.0 TOKA (Chain 31338)"
  echo -e "${GREEN}User:${NC}         $USER_ADDR"
  echo -e "${GREEN}Recipient:${NC}    $RECIPIENT_ADDR"
  
  # Extract and display preference if available
  local preference=$(echo "$quote_json" | jq -r '.quotes[0].preference // "N/A"')
  if [ "$preference" != "N/A" ]; then
    echo -e "${GREEN}Preference:${NC}   $preference"
  fi
}

QUOTE_PAYLOAD=$(jq -n \
  --arg user "$USER_UII_ORIGIN" \
  --arg a_user "$USER_UII_ORIGIN" \
  --arg a_asset "$TOKENA_UII_ORIGIN" \
  --arg a_amount "$ONE" \
  --arg r_receiver "$RECIPIENT_UII_DEST" \
  --arg r_asset "$TOKENA_UII_DEST" \
  --arg r_amount "$ONE" \
  '{
    user: $user,
    availableInputs: [ { user: $a_user, asset: $a_asset, amount: $a_amount } ],
    requestedOutputs: [ { receiver: $r_receiver, asset: $r_asset, amount: $r_amount } ],
    preference: "speed",
    minValidUntil: 600
  }')

echo -e "${YELLOW}📤 Sending quote request...${NC}"
QUOTE_RESP=$(curl -s -X POST "$QUOTE_ENDPOINT" -H "Content-Type: application/json" -d "$QUOTE_PAYLOAD")

if ! echo "$QUOTE_RESP" | jq -e '.quotes[0]' >/dev/null 2>&1; then
  echo -e "${RED}Quote request failed${NC}"
  echo "$QUOTE_RESP" | jq .
  exit 1
fi

echo -e "${GREEN}✅ Quote received${NC}"


echo ""
echo -e "${BLUE}📄 Raw Quote Details${NC}"
echo "==================="
echo "$QUOTE_RESP" | jq .

echo ""
TMP_QUOTE_JSON="/tmp/quote_$$.json"
echo "$QUOTE_RESP" > "$TMP_QUOTE_JSON"

echo -e "${YELLOW}✍️  Signing and submitting intent via build_transaction.sh...${NC}"
scripts/demo/build_transaction.sh "$TMP_QUOTE_JSON" "$ORDERS_ENDPOINT"

echo -e "${GREEN}🎉 Intent Submitted${NC}"

# Display formatted quote summary
display_quote_summary "$QUOTE_RESP"
