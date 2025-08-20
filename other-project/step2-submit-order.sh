#!/bin/bash
# Step 2: Create user intent signature and submit order to solver
# This script generates the signature and submits the order via API endpoint

# Load shared configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/config.sh"

# Check requirements
check_requirements

log_info "Step 2: Create user intent and submit order to solver"
log_info "===================================================="

# Check if step1 completed successfully
if [[ ! -f "$STEP1_STATE_FILE" ]]; then
    log_error "Step 1 must be completed first. Run step1-deposit.sh"
    
    ERROR_JSON=$(cat <<EOF
{
  "success": false,
  "step": "submit-order",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "error": "Step 1 not completed. Missing state file: $STEP1_STATE_FILE"
}
EOF
)
    output_json "$ERROR_JSON"
    exit 1
fi

# Load step1 results
STEP1_RESULT=$(cat "$STEP1_STATE_FILE")

# More robust JSON parsing for boolean values
if command -v jq &> /dev/null; then
    # Use jq if available (most reliable)
    STEP1_SUCCESS=$(echo "$STEP1_RESULT" | jq -r '.success')
    TOKEN_ID=$(echo "$STEP1_RESULT" | jq -r '.tokenId')
    NONCE=$(echo "$STEP1_RESULT" | jq -r '.nonce')
else
    # Fallback parsing for boolean true/false
    if echo "$STEP1_RESULT" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
        STEP1_SUCCESS="true"
    else
        STEP1_SUCCESS="false"
    fi
    
    # Parse token ID with fallback methods
    TOKEN_ID=$(echo "$STEP1_RESULT" | grep -o '"tokenId":"[^"]*"' | cut -d':' -f2 | tr -d '"')
    
    # Parse nonce
    NONCE=$(echo "$STEP1_RESULT" | grep -o '"nonce":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    
    # Alternative parsing method if first fails
    if [[ -z "$TOKEN_ID" ]]; then
        log_warning "Primary tokenId extraction failed, trying alternative method..."
        TOKEN_ID=$(echo "$STEP1_RESULT" | sed -n 's/.*"tokenId":"\([^"]*\)".*/\1/p')
    fi
fi

# Debug output
log_info "Extracted STEP1_SUCCESS: '$STEP1_SUCCESS'"
log_info "Extracted TOKEN_ID: '$TOKEN_ID'"
log_info "Extracted NONCE: '$NONCE'"

if [[ "$STEP1_SUCCESS" != "true" ]]; then
    log_error "Step 1 did not complete successfully"
    
    ERROR_JSON=$(cat <<EOF
{
  "success": false,
  "step": "submit-order",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "error": "Step 1 failed. Check step1 results."
}
EOF
)
    output_json "$ERROR_JSON"
    exit 1
fi

# Validate token ID
if [[ -z "$TOKEN_ID" || "$TOKEN_ID" == "null" ]]; then
    log_error "Failed to extract token ID from step 1 result"
    log_error "Step1 result: $STEP1_RESULT"
    
    ERROR_JSON=$(cat <<EOF
{
  "success": false,
  "step": "submit-order",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "error": "Failed to extract token ID from step 1"
}
EOF
)
    output_json "$ERROR_JSON"
    exit 1
fi

# Validate nonce
if [[ -z "$NONCE" || "$NONCE" == "null" ]]; then
    log_error "Failed to extract nonce from step 1 result"
    log_error "Step1 result: $STEP1_RESULT"
    
    ERROR_JSON=$(cat <<EOF
{
  "success": false,
  "step": "submit-order",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "error": "Failed to extract nonce from step 1"
}
EOF
)
    output_json "$ERROR_JSON"
    exit 1
fi

log_info "Using nonce from step 1: $NONCE"

# Step 2.1: Generate sponsor signature
log_info "Generating sponsor signature..."

# Get domain separator from TheCompact
DOMAIN_SEPARATOR=$(cast call $THE_COMPACT "DOMAIN_SEPARATOR()" --rpc-url $ORIGIN_RPC)
log_info "Domain separator: $DOMAIN_SEPARATOR"

# Prepare signature parameters
REMOTE_ORACLE_BYTES32=$(printf "0x%064s" "${DEST_ORACLE#0x}")
REMOTE_FILLER_BYTES32=$(printf "0x%064s" "${COIN_FILLER#0x}")
OUTPUT_TOKEN_BYTES32=$(printf "0x%064s" "${TOKEN_A_DEST#0x}")
RECIPIENT_BYTES32=$(printf "0x%064s" "${USER_ADDRESS#0x}")

# Set environment variables for signature generation script
export SIGNATURE_PRIVATE_KEY=$PRIVATE_KEY
export SIGNATURE_ARBITER=$SETTLER_COMPACT
export SIGNATURE_SPONSOR=$USER_ADDRESS
export SIGNATURE_NONCE=$NONCE
export SIGNATURE_EXPIRES=$EXPIRES
export SIGNATURE_TOKEN_ID=$TOKEN_ID
export SIGNATURE_INPUT_AMOUNT=$DEPOSIT_AMOUNT
export SIGNATURE_OUTPUT_AMOUNT=$OUTPUT_AMOUNT
export SIGNATURE_FILL_DEADLINE=$FILL_DEADLINE
export SIGNATURE_LOCAL_ORACLE=$ORIGIN_ORACLE
export SIGNATURE_REMOTE_ORACLE=$REMOTE_ORACLE_BYTES32
export SIGNATURE_REMOTE_FILLER=$REMOTE_FILLER_BYTES32
export SIGNATURE_CHAIN_ID=$DEST_CHAIN_ID
export SIGNATURE_OUTPUT_TOKEN=$OUTPUT_TOKEN_BYTES32
export SIGNATURE_RECIPIENT=$RECIPIENT_BYTES32
export SIGNATURE_DOMAIN_SEPARATOR=$DOMAIN_SEPARATOR

# Generate signature using proper EIP-712 Solidity script (same as test-full-workflow.sh)
log_info "Generating signature using proper EIP-712 method..."

# Check if GenerateSignature.s.sol exists
if [[ ! -f "utils/script/GenerateSignature.s.sol" ]]; then
    log_error "GenerateSignature.s.sol not found. Please ensure the signature generation script exists."
    log_error "Current directory: $(pwd)"
    log_error "Looking for: utils/script/GenerateSignature.s.sol"
    exit 1
fi

# Run the signature generation script with RPC URL for contract calls
SIGNATURE_OUTPUT=$(forge script utils/script/GenerateSignature.s.sol:GenerateSignature --root utils --rpc-url $ORIGIN_RPC -vv)
SIGNATURE=$(echo "$SIGNATURE_OUTPUT" | grep "0x" | tail -1 | tr -d '[:space:]')

# Verify signature format
if [[ "$SIGNATURE" =~ ^0x[0-9a-fA-F]{130}$ ]]; then
    log_success "Generated valid signature: ${SIGNATURE:0:20}..."
    SIGNATURE_VALID=true
else
    log_error "Signature generation failed or invalid format"
    log_error "Raw signature output: '$SIGNATURE_OUTPUT'"
    log_error "Extracted signature: '$SIGNATURE' (length: ${#SIGNATURE})"
    
    # Try fallback but warn it will likely fail
    log_warning "Using fallback signature (will likely be rejected by backend)"
    if [[ -z "$SIGNATURE" ]]; then
        SIGNATURE="0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
    fi
    SIGNATURE_VALID=false
fi

# Step 2.2: Create order payload
log_info "Creating order payload..."

ORDER_PAYLOAD=$(cat <<EOF
{
  "order": {
    "user": "$USER_ADDRESS",
    "nonce": $NONCE,
    "originChainId": $ORIGIN_CHAIN_ID,
    "expires": $EXPIRES,
    "fillDeadline": $FILL_DEADLINE,
    "localOracle": "$ORIGIN_ORACLE",
    "inputs": [["$TOKEN_ID", "$DEPOSIT_AMOUNT"]],
    "outputs": [{
      "remoteOracle": "$DEST_ORACLE",
      "remoteFiller": "$COIN_FILLER",
      "chainId": $DEST_CHAIN_ID,
      "token": "$TOKEN_A_DEST",
      "amount": "$OUTPUT_AMOUNT",
      "recipient": "$USER_ADDRESS"
    }]
  },
  "signature": "$SIGNATURE"
}
EOF
)

log_info "Order payload created"

# Step 2.3: Submit order to solver API
log_info "Submitting order to solver API..."

# Make API call
API_RESPONSE=$(curl -s -X POST "$SOLVER_API_URL/api/v1/orders" \
    -H "Content-Type: application/json" \
    -d "$ORDER_PAYLOAD" 2>&1)

# Parse API response
if echo "$API_RESPONSE" | grep -q '"success":true'; then
    log_success "Order submitted successfully"
    
    # Extract order ID from response
    ORDER_ID=$(echo "$API_RESPONSE" | grep -o '"orderId":"[^"]*"' | cut -d':' -f2 | tr -d '"')
    QUEUE_POSITION=$(echo "$API_RESPONSE" | grep -o '"queuePosition":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    
    # Ensure queue position has a valid value for JSON
    if [[ -z "$QUEUE_POSITION" || "$QUEUE_POSITION" == "null" ]]; then
        QUEUE_POSITION="null"
    fi
    
    log_info "Order ID: $ORDER_ID"
    log_info "Queue position: $QUEUE_POSITION"
    
    SUCCESS=true
    ERROR_MESSAGE=""
else
    log_error "Failed to submit order"
    log_error "API Response: $API_RESPONSE"
    
    SUCCESS=false
    ERROR_MESSAGE="API submission failed"
    ORDER_ID=""
    QUEUE_POSITION="null"
fi

# Step 2.4: Check queue status
log_info "Checking queue status..."
QUEUE_RESPONSE=$(curl -s "$SOLVER_API_URL/api/v1/queue" 2>&1)

log_success "Step 2 completed"

# Create JSON output
RESULT_JSON=$(cat <<EOF
{
  "success": $SUCCESS,
  "step": "submit-order",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "orderId": "$ORDER_ID",
  "queuePosition": $QUEUE_POSITION,
  "signature": "$SIGNATURE",
  "signatureValid": $SIGNATURE_VALID,
  "order": {
    "user": "$USER_ADDRESS",
    "nonce": $NONCE,
    "originChainId": $ORIGIN_CHAIN_ID,
    "expires": $EXPIRES,
    "fillDeadline": $FILL_DEADLINE,
    "tokenId": "$TOKEN_ID",
    "inputAmount": "$DEPOSIT_AMOUNT",
    "outputAmount": "$OUTPUT_AMOUNT"
  },
  "apiResponse": $API_RESPONSE,
  "queueStatus": $QUEUE_RESPONSE,
  "error": ${ERROR_MESSAGE:+\"$ERROR_MESSAGE\"}${ERROR_MESSAGE:-null}
}
EOF
)

# Save state for next step
echo "$RESULT_JSON" > "$STEP2_STATE_FILE"

# Output JSON result
output_json "$RESULT_JSON" 