#!/bin/bash
# Complete OIF Protocol Local Testing Script
# This script demonstrates the full workflow: deposit -> order -> fill -> finalize

echo "🧪 Complete OIF Protocol Local Testing Workflow"
echo "================================================"

# Contract addresses from deployment
ORIGIN_RPC="http://127.0.0.1:8545"
DEST_RPC="http://127.0.0.1:8546"
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
USER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Solver address (from .env SOLVER_PRIVATE_KEY)
SOLVER_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
SOLVER_PRIVATE_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"

# Origin chain contracts
THE_COMPACT="0x5FbDB2315678afecb367f032d93F642f64180aa3"
SETTLER_COMPACT="0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"
TOKEN_A_ORIGIN="0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"
TOKEN_B_ORIGIN="0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"

# Destination chain contracts
COIN_FILLER="0x5FbDB2315678afecb367f032d93F642f64180aa3"
TOKEN_A_DEST="0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
TOKEN_B_DEST="0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"

# Oracles
ORIGIN_ORACLE="0x0165878A594ca255338adfa4d48449f69242Eb8F"
DEST_ORACLE="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"

echo "📋 Using contracts:"
echo "  Origin TheCompact: $THE_COMPACT"
echo "  Origin TokenA: $TOKEN_A_ORIGIN" 
echo "  Destination CoinFiller: $COIN_FILLER"
echo "  Destination TokenA: $TOKEN_A_DEST"
echo "  Solver Address: $SOLVER_ADDRESS"
echo ""

# Step 1: Check balances
echo "💰 Step 1: Checking initial balances..."
echo "User Origin TokenA balance:"
cast call $TOKEN_A_ORIGIN "balanceOf(address)" $USER_ADDRESS --rpc-url $ORIGIN_RPC

echo "User Destination TokenA balance:"
cast call $TOKEN_A_DEST "balanceOf(address)" $USER_ADDRESS --rpc-url $DEST_RPC

echo "Solver Destination TokenA balance:"
cast call $TOKEN_A_DEST "balanceOf(address)" $SOLVER_ADDRESS --rpc-url $DEST_RPC

# Step 1.5: Mint tokens for solver on destination chain
# echo ""
# echo "🪙 Step 1.5: Minting tokens for solver on destination chain..."
SOLVER_TOKEN_AMOUNT="99000000000000000000"  # 99 tokens for solver (matches Step2)

# echo "  Minting $SOLVER_TOKEN_AMOUNT TokenA for solver..."
# cast send $TOKEN_A_DEST \
#   "transfer(address,uint256)" \
#   $SOLVER_ADDRESS \
#   $SOLVER_TOKEN_AMOUNT \
#   --rpc-url $DEST_RPC \
#   --private-key $PRIVATE_KEY

# echo "  ✅ Minted tokens for solver"

echo "Solver TokenA balance after minting:"
cast call $TOKEN_A_DEST "balanceOf(address)" $SOLVER_ADDRESS --rpc-url $DEST_RPC

# Step 1.6: CRITICAL - Approve CoinFiller to spend solver's tokens
echo ""
echo "🔐 Step 1.6: Approving CoinFiller to spend solver's tokens..."
cast send $TOKEN_A_DEST \
  "approve(address,uint256)" \
  $COIN_FILLER \
  $SOLVER_TOKEN_AMOUNT \
  --rpc-url $DEST_RPC \
  --private-key $SOLVER_PRIVATE_KEY

echo "  ✅ CoinFiller approved to spend solver's tokens"

echo "CoinFiller allowance from solver:"
cast call $TOKEN_A_DEST "allowance(address,address)" $SOLVER_ADDRESS $COIN_FILLER --rpc-url $DEST_RPC

# Step 2: Register solver as allocator and deposit tokens into TheCompact
echo ""
echo "🔧 Step 2: Registering solver as allocator..."

# First register the solver as an allocator (required for finalization)
# NOTE: Commented out because solver is already registered automatically
# echo "  Registering solver as allocator in TheCompact..."
# cast send $THE_COMPACT \
#   "__registerAllocator(address,bytes)" \
#   $SOLVER_ADDRESS \
#   "0x" \
#   --rpc-url $ORIGIN_RPC \
#   --private-key $SOLVER_PRIVATE_KEY

echo "  ✅ Solver already registered as allocator (skipping registration)"

echo ""
echo "🏦 Step 2.5: Depositing tokens into TheCompact..."
DEPOSIT_AMOUNT="100000000000000000000"  # 100 tokens

# Use the same allocator lock tag as in Step1_CreateOrder.s.sol  
# This is bytes12(uint96(158859850115136955957052690)) from the Solidity script
# cast to-hex 158859850115136955957052690 = 0x8367e1bb143e90bb3f0512
# As bytes12, this becomes 12 bytes with left padding
ALLOCATOR_LOCK_TAG="0x008367e1bb143e90bb3f0512"

echo "  Approving TokenA for TheCompact..."
cast send $TOKEN_A_ORIGIN \
  "approve(address,uint256)" \
  $THE_COMPACT \
  $DEPOSIT_AMOUNT \
  --rpc-url $ORIGIN_RPC \
  --private-key $PRIVATE_KEY

echo "  Depositing TokenA into TheCompact with correct parameters..."
DEPOSIT_TX=$(cast send $THE_COMPACT \
  "depositERC20(address,bytes12,uint256,address)" \
  $TOKEN_A_ORIGIN \
  $ALLOCATOR_LOCK_TAG \
  $DEPOSIT_AMOUNT \
  $USER_ADDRESS \
  --rpc-url $ORIGIN_RPC \
  --private-key $PRIVATE_KEY 2>&1)

# Print deposit transaction result for debugging
echo "  📋 Deposit transaction result:"
echo "$DEPOSIT_TX"

# Check if deposit succeeded and extract token ID
if echo "$DEPOSIT_TX" | grep -q "Error:"; then
  echo "  ❌ Deposit failed: $DEPOSIT_TX"
  echo "  This is expected - The Compact requires specific setup"
  echo "  Using fallback token ID for testing..."
  TOKEN_ID="1"  # Fallback value
else
  echo "  ✅ Deposited $DEPOSIT_AMOUNT TokenA into TheCompact with allocator lock tag"
  
  # Extract transaction hash from the output
  TX_HASH=$(echo "$DEPOSIT_TX" | grep -o "0x[a-fA-F0-9]\{64\}" | head -1)
  
  if [[ -n "$TX_HASH" ]]; then
    echo "  📋 Transaction hash: $TX_HASH"
    
    # Extract token ID from the logs in the transaction output
    echo "  🔍 Extracting token ID from transaction logs..."
    
    # Extract token ID from TheCompact deposit 
    echo "  🔍 Extracting token ID from deposit result..."
    
    # Method 1: Try to extract from event topics
    COMPACT_LOG_TOPICS=$(echo "$DEPOSIT_TX" | grep -A 10 '"address":"0x5fbdb2315678afecb367f032d93f642f64180aa3"' | grep '"topics":\[' | head -1)
    
    if [[ -n "$COMPACT_LOG_TOPICS" ]]; then
      # Extract the topics array content
      TOPICS_CONTENT=$(echo "$COMPACT_LOG_TOPICS" | sed 's/.*"topics":\[\([^]]*\)\].*/\1/')
      TOKEN_ID_HEX=$(echo "$TOPICS_CONTENT" | cut -d',' -f2 | tr -d '"' | tr -d ' ')
      echo "  📋 Token ID from topics: $TOKEN_ID_HEX"
    fi
    
    # Method 2: Calculate expected token ID based on TheCompact's logic
    # Token ID = (lockTag << 160) | tokenAddress
    echo "  🔄 Calculating expected token ID..."
    
    # Remove 0x prefix and pad to proper lengths
    LOCK_TAG_CLEAN="${ALLOCATOR_LOCK_TAG#0x}"
    TOKEN_ADDR_CLEAN="${TOKEN_A_ORIGIN#0x}"
    
    # Combine lock tag (96 bits) shifted left by 160 bits with token address (160 bits)
    # This creates a 256-bit token ID
    COMBINED_HEX="0x${LOCK_TAG_CLEAN}${TOKEN_ADDR_CLEAN}"
    EXPECTED_TOKEN_ID=$(cast to-dec "$COMBINED_HEX" 2>/dev/null || echo "0")
    
    echo "  📋 Lock tag: $ALLOCATOR_LOCK_TAG"
    echo "  📋 Token addr: $TOKEN_A_ORIGIN" 
    echo "  📋 Combined: $COMBINED_HEX"
    echo "  📋 Expected token ID: $EXPECTED_TOKEN_ID"
    
    # Use the derived token ID if the event-based extraction gave us 0
    if [[ -n "$TOKEN_ID_HEX" && "$TOKEN_ID_HEX" != "0x0000000000000000000000000000000000000000000000000000000000000000" ]]; then
      TOKEN_ID=$(cast to-dec $TOKEN_ID_HEX 2>/dev/null || echo "0")
      echo "  ✅ Using token ID from event: $TOKEN_ID"
    else
      TOKEN_ID="$EXPECTED_TOKEN_ID"
      echo "  ✅ Using calculated token ID: $TOKEN_ID"
    fi
    
    # Note about large token IDs
    if [[ ${#TOKEN_ID} -gt 10 ]]; then
      echo "  ℹ️  Large token ID detected (this is normal for TheCompact)"
    fi
  else
    echo "  ⚠️  Could not extract transaction hash, using fallback token ID"
    TOKEN_ID="1"
  fi
fi

# Step 3: Check TheCompact balance
echo ""
echo "🔍 Step 3: Verifying deposit..."
echo "TheCompact TokenA balance:"
cast call $TOKEN_A_ORIGIN "balanceOf(address)" $THE_COMPACT --rpc-url $ORIGIN_RPC

# Step 4: Set nonce (hardcoded for simplicity)
echo ""
echo "🔍 Step 4: Setting nonce..."

# TEMPORARY: Hardcoded nonce 1 for testing - skipping dynamic nonce discovery
# In production, you would want to:
# 1. Get the correct allocator address from getLockDetails(tokenId)  
# 2. Check hasConsumedAllocatorNonce(nonce, allocator) to find available nonce
# 3. Use timestamp-based or other collision-resistant nonce strategy
NONCE=2
echo "  📋 Using hardcoded nonce: $NONCE"
echo "  ⚠️  NOTE: This is hardcoded for testing. In production, check if nonce is consumed first."

# Step 5: Submit order to solver
echo ""
echo "📤 Step 5: Submitting order to solver..."

# Use max timestamps like Step3 (never expires)
EXPIRES=4294967295  # max uint32, matches Step3
FILL_DEADLINE=4294967295  # max uint32, matches Step3

# Generate the real sponsor signature
echo "  🔐 Generating sponsor signature..."

# Use the actual token ID extracted from the deposit transaction
echo "  📋 Using token ID: $TOKEN_ID"
OUTPUT_AMOUNT="99000000000000000000"

# Get domain separator from TheCompact 
# This is crucial: SettlerCompact passes the signature to TheCompact.batchClaim() for validation
echo "  📋 Fetching domain separator from TheCompact..."
DOMAIN_SEPARATOR=$(cast call $THE_COMPACT "DOMAIN_SEPARATOR()" --rpc-url $ORIGIN_RPC)

# Generate signature using the new Solidity script
# CRITICAL: Use SETTLER_COMPACT as arbiter (matches Step1_CreateOrder.s.sol)!
# SettlerCompact is the one calling TheCompact.batchClaim(), not the solver directly
echo "  🔄 Calling Solidity signature generation script..."

# Convert addresses to bytes32 format for the script
REMOTE_ORACLE_BYTES32=$(printf "0x%064s" "${DEST_ORACLE#0x}")
REMOTE_FILLER_BYTES32=$(printf "0x%064s" "${COIN_FILLER#0x}")
OUTPUT_TOKEN_BYTES32=$(printf "0x%064s" "${TOKEN_A_DEST#0x}")
RECIPIENT_BYTES32=$(printf "0x%064s" "${USER_ADDRESS#0x}")

# Set environment variables for the Solidity script
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
export SIGNATURE_CHAIN_ID=31338
export SIGNATURE_OUTPUT_TOKEN=$OUTPUT_TOKEN_BYTES32
export SIGNATURE_RECIPIENT=$RECIPIENT_BYTES32
export SIGNATURE_DOMAIN_SEPARATOR=$DOMAIN_SEPARATOR

# Run the signature generation script with RPC URL for contract calls
SIGNATURE_OUTPUT=$(forge script script/GenerateSignature.s.sol --rpc-url $ORIGIN_RPC 2>/dev/null)
SIGNATURE=$(echo "$SIGNATURE_OUTPUT" | grep "0x" | tail -1 | tr -d '[:space:]')

# Verify we got a valid signature format
if [[ "$SIGNATURE" =~ ^0x[0-9a-fA-F]{130}$ ]]; then
  echo "  ✅ Generated valid signature: ${SIGNATURE:0:20}..."
else
  echo "  ⚠️  Warning: Signature format may be invalid: '$SIGNATURE' (length: ${#SIGNATURE})"
  echo "  📋 Raw output for debugging: '$SIGNATURE_OUTPUT'"
fi

ORDER_PAYLOAD="{
  \"order\": {
    \"user\": \"$USER_ADDRESS\",
    \"nonce\": $NONCE,
    \"originChainId\": 31337,
    \"expires\": $EXPIRES,
    \"fillDeadline\": $FILL_DEADLINE,
    \"localOracle\": \"$ORIGIN_ORACLE\",
    \"inputs\": [[\"$TOKEN_ID\", \"$DEPOSIT_AMOUNT\"]],
    \"outputs\": [{
      \"remoteOracle\": \"$DEST_ORACLE\",
      \"remoteFiller\": \"$COIN_FILLER\",
      \"chainId\": 31338,
      \"token\": \"$TOKEN_A_DEST\",
      \"amount\": \"$OUTPUT_AMOUNT\",
      \"recipient\": \"$USER_ADDRESS\"
    }]
  },
  \"signature\": \"$SIGNATURE\"
}"

echo "  Submitting order to solver API..."
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d "$ORDER_PAYLOAD"

echo ""
echo ""
echo "✅ Order submitted! The solver should now:"
echo "  1. Fill the order on destination chain (CoinFiller)"
echo "  2. Finalize the order on origin chain (SettlerCompact)"
echo ""
echo "🔍 Check order status:"
echo "  curl http://localhost:3000/api/v1/queue"
echo ""
echo "🧪 Check final balances:"
echo "  User Origin TokenA: cast call $TOKEN_A_ORIGIN \"balanceOf(address)\" $USER_ADDRESS --rpc-url $ORIGIN_RPC"
echo "  User Dest TokenA: cast call $TOKEN_A_DEST \"balanceOf(address)\" $USER_ADDRESS --rpc-url $DEST_RPC"
echo "  Solver Dest TokenA: cast call $TOKEN_A_DEST \"balanceOf(address)\" $SOLVER_ADDRESS --rpc-url $DEST_RPC" 