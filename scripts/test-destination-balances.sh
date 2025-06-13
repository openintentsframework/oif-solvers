#!/bin/bash
# Balance Checker for OIF Protocol Local Testing
# This script checks balances for user and solver on both origin and destination chains

echo "💰 OIF Protocol Balance Checker"
echo "==============================="

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

echo "📋 Contract addresses:"
echo "  User Address: $USER_ADDRESS"
echo "  Solver Address: $SOLVER_ADDRESS"
echo "  Origin TokenA: $TOKEN_A_ORIGIN"
echo "  Destination TokenA: $TOKEN_A_DEST"
echo "  TheCompact: $THE_COMPACT"
echo "  CoinFiller: $COIN_FILLER"
echo ""

# Function to convert wei to readable format (18 decimals)
wei_to_tokens() {
    local wei_amount=$1
    
    # Handle empty or invalid input
    if [[ -z "$wei_amount" || "$wei_amount" == "0x" ]]; then
        echo "0"
        return
    fi
    
    # Convert hex to decimal if needed
    if [[ "$wei_amount" =~ ^0x[0-9a-fA-F]+$ ]]; then
        # Convert hex to decimal using cast
        wei_amount=$(cast to-dec "$wei_amount" 2>/dev/null)
    fi
    
    # Check if we have a valid decimal number
    if [[ "$wei_amount" =~ ^[0-9]+$ ]]; then
        # Use bc for decimal calculation if available, otherwise use basic division
        if command -v bc >/dev/null 2>&1; then
            echo "scale=6; $wei_amount / 1000000000000000000" | bc
        else
            # Fallback: simple division (loses precision)
            local tokens=$((wei_amount / 1000000000000000000))
            local remainder=$((wei_amount % 1000000000000000000))
            if [[ $remainder -gt 0 ]]; then
                echo "$tokens.${remainder:0:6}"
            else
                echo "$tokens"
            fi
        fi
    else
        echo "0"
    fi
}

echo "🔍 Checking balances on both chains..."
echo ""

# Origin Chain Balances
echo "🏠 ORIGIN CHAIN (Chain ID: 31337)"
echo "=================================="

echo "📊 User TokenA Balance:"
USER_ORIGIN_BALANCE=$(cast call $TOKEN_A_ORIGIN "balanceOf(address)" $USER_ADDRESS --rpc-url $ORIGIN_RPC 2>/dev/null)
USER_ORIGIN_TOKENS=$(wei_to_tokens $USER_ORIGIN_BALANCE)
echo "  Raw: $USER_ORIGIN_BALANCE wei"
echo "  Formatted: $USER_ORIGIN_TOKENS tokens"

echo ""
echo "📊 Solver TokenA Balance:"
SOLVER_ORIGIN_BALANCE=$(cast call $TOKEN_A_ORIGIN "balanceOf(address)" $SOLVER_ADDRESS --rpc-url $ORIGIN_RPC 2>/dev/null)
SOLVER_ORIGIN_TOKENS=$(wei_to_tokens $SOLVER_ORIGIN_BALANCE)
echo "  Raw: $SOLVER_ORIGIN_BALANCE wei"
echo "  Formatted: $SOLVER_ORIGIN_TOKENS tokens"

echo ""
echo "📊 TheCompact TokenA Balance:"
COMPACT_BALANCE=$(cast call $TOKEN_A_ORIGIN "balanceOf(address)" $THE_COMPACT --rpc-url $ORIGIN_RPC 2>/dev/null)
COMPACT_TOKENS=$(wei_to_tokens $COMPACT_BALANCE)
echo "  Raw: $COMPACT_BALANCE wei"
echo "  Formatted: $COMPACT_TOKENS tokens"

echo ""
echo ""

# Destination Chain Balances
echo "🌍 DESTINATION CHAIN (Chain ID: 31338)"
echo "======================================"

echo "📊 User TokenA Balance:"
USER_DEST_BALANCE=$(cast call $TOKEN_A_DEST "balanceOf(address)" $USER_ADDRESS --rpc-url $DEST_RPC 2>/dev/null)
USER_DEST_TOKENS=$(wei_to_tokens $USER_DEST_BALANCE)
echo "  Raw: $USER_DEST_BALANCE wei"
echo "  Formatted: $USER_DEST_TOKENS tokens"

echo ""
echo "📊 Solver TokenA Balance:"
SOLVER_DEST_BALANCE=$(cast call $TOKEN_A_DEST "balanceOf(address)" $SOLVER_ADDRESS --rpc-url $DEST_RPC 2>/dev/null)
SOLVER_DEST_TOKENS=$(wei_to_tokens $SOLVER_DEST_BALANCE)
echo "  Raw: $SOLVER_DEST_BALANCE wei"
echo "  Formatted: $SOLVER_DEST_TOKENS tokens"

echo ""
echo "📊 CoinFiller TokenA Balance:"
FILLER_BALANCE=$(cast call $TOKEN_A_DEST "balanceOf(address)" $COIN_FILLER --rpc-url $DEST_RPC 2>/dev/null)
FILLER_TOKENS=$(wei_to_tokens $FILLER_BALANCE)
echo "  Raw: $FILLER_BALANCE wei"
echo "  Formatted: $FILLER_TOKENS tokens"

echo ""
echo "📊 CoinFiller Allowance from Solver:"
SOLVER_ALLOWANCE=$(cast call $TOKEN_A_DEST "allowance(address,address)" $SOLVER_ADDRESS $COIN_FILLER --rpc-url $DEST_RPC 2>/dev/null)
ALLOWANCE_TOKENS=$(wei_to_tokens $SOLVER_ALLOWANCE)
echo "  Raw: $SOLVER_ALLOWANCE wei"
echo "  Formatted: $ALLOWANCE_TOKENS tokens"

echo ""
echo ""

# Summary
echo "📝 BALANCE SUMMARY"
echo "=================="
echo "Origin Chain (31337):"
echo "  👤 User TokenA: $USER_ORIGIN_TOKENS tokens"
echo "  🤖 Solver TokenA: $SOLVER_ORIGIN_TOKENS tokens"
echo "  🏛️  TheCompact TokenA: $COMPACT_TOKENS tokens"
echo ""
echo "Destination Chain (31338):"
echo "  👤 User TokenA: $USER_DEST_TOKENS tokens"
echo "  🤖 Solver TokenA: $SOLVER_DEST_TOKENS tokens"
echo "  🏪 CoinFiller TokenA: $FILLER_TOKENS tokens"
echo "  🔒 Solver→CoinFiller Allowance: $ALLOWANCE_TOKENS tokens"
echo ""

# Additional useful commands
echo "🛠️  USEFUL COMMANDS"
echo "=================="
echo "Check order queue:"
echo "  curl http://localhost:3000/api/v1/queue"
echo ""
echo "Re-run this balance check:"
echo "  bash solver/test-destination-balances.sh"
echo ""
echo "Run full workflow test:"
echo "  bash solver/test-full-workflow.sh"