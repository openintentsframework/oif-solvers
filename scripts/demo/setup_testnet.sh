#!/bin/bash

# OIF Solver Testnet Environment Setup Script
# ===========================================
#
# This script sets up a complete testnet testing environment for the OIF cross-chain solver.
# It performs the following operations:
#
# 1. Uses SOLVER_ADDRESS and USER_ADDRESS defined below
# 2. Deploys smart contracts on both testnets:
#    - InputSettlerEscrow on Base Sepolia (origin chain)
#    - OutputSettler7683 on Arbitrum Sepolia (destination chain)
#    - Mock Oracle contract for intent validation
#
# 3. Configures the test environment for USDC transfers:
#    - Uses USDC on both chains (requires token balances)
#    - Generates modular configuration files for the solver
#
# After running this script, you can:
# - Start the solver with: cargo run --bin solver-service -- --config config/testnet.toml
# - Send onchain test intents using: ./scripts/demo/send_onchain_intent.sh
# - Send offchain test intents using: ./scripts/demo/send_offchain_intent.sh

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================================================
# ADDRESSES - PASTE YOUR ADDRESSES HERE
# ============================================================================
SOLVER_ADDRESS=""  # Your solver address here
SOLVER_PRIVATE_KEY="" # Your solver private key here
USER_ADDRESS=""    # Your user address here
USER_PRIVATE_KEY="" # Your user private key here
DEST_RECIPIENT_ADDR="" # address of the destination recipient where the tokens will be sent to

# ============================================================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================================================

# RPC URLs for the testnets (you can use public endpoints or private RPCs if you have them)
ORIGIN_RPC_URL="https://sepolia.base.org"
DEST_RPC_URL="https://arbitrum-sepolia.drpc.org"

# Chain IDs
ORIGIN_CHAIN_ID=84532     # Base Sepolia
DEST_CHAIN_ID=421614      # Arbitrum Sepolia

# USDC Token Addresses
ORIGIN_USDC_ADDRESS="0x036CbD53842c5426634e7929541eC2318f3dCF7e"    # USDC on Base Sepolia
DEST_USDC_ADDRESS="0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"    # USDC on Arbitrum Sepolia
# Note: Please verify the Arbitrum Sepolia USDC address above. You may need to:
# 1. Check https://sepolia.arbiscan.io/ for the correct USDC contract address
# 2. Or deploy your own test USDC token on Arbitrum Sepolia
# 3. Or use an existing testnet token if USDC is not available

# Load environment variables from .env file
load_env_file() {
    local env_file=".env"
    
    if [ ! -f "$env_file" ]; then
        echo -e "${RED}❌ Error: .env file not found${NC}"
        echo
        echo -e "${YELLOW}Please create a .env file with your deployment private key:${NC}"
        echo "  DEPLOYMENT_PRIVATE_KEY=0x_your_64_character_hex_key_here"
        echo
        echo -e "${YELLOW}Get your private key from MetaMask:${NC}"
        echo "  Account Details > Export Private Key"
        echo "  WARNING: Only use testnet accounts, NEVER mainnet keys!"
        exit 1
    fi
    
    # Load only DEPLOYMENT_PRIVATE_KEY from .env file
    DEPLOYMENT_PRIVATE_KEY=$(grep "^DEPLOYMENT_PRIVATE_KEY=" "$env_file" | cut -d'=' -f2- | sed 's/^["'\'']//' | sed 's/["'\'']$//')
    
    if [ -z "$DEPLOYMENT_PRIVATE_KEY" ]; then
        echo -e "${RED}❌ Error: DEPLOYMENT_PRIVATE_KEY not found in .env file${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓${NC} Loaded DEPLOYMENT_PRIVATE_KEY from .env"
}

# Validate addresses
validate_addresses() {
    local errors=()
    
    # Check if SOLVER_ADDRESS is set
    if [ -z "$SOLVER_ADDRESS" ]; then
        errors+=("SOLVER_ADDRESS not set - please paste your solver address at the top of this script")
    elif [[ ! "$SOLVER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        errors+=("SOLVER_ADDRESS has invalid format - should be 0x followed by 40 hex characters")
    fi
    
    # Check if USER_ADDRESS is set
    if [ -z "$USER_ADDRESS" ]; then
        errors+=("USER_ADDRESS not set - please paste your user address at the top of this script")
    elif [[ ! "$USER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        errors+=("USER_ADDRESS has invalid format - should be 0x followed by 40 hex characters")
    fi
    
    if [ ${#errors[@]} -ne 0 ]; then
        echo -e "${RED}Configuration errors found:${NC}"
        for error in "${errors[@]}"; do
            echo "  ❌ $error"
        done
        echo
        echo -e "${YELLOW}Please update the addresses at the top of this script:${NC}"
        echo "  SOLVER_ADDRESS=\"0x...\""
        echo "  USER_ADDRESS=\"0x...\""
        exit 1
    fi
    
    echo -e "${GREEN}✓${NC} Addresses validated"
}

# Validate configuration
validate_config() {
    local errors=()
    
    # Check if DEPLOYMENT_PRIVATE_KEY is set
    if [ -z "$DEPLOYMENT_PRIVATE_KEY" ]; then
        errors+=("DEPLOYMENT_PRIVATE_KEY not found - please add it to your .env file")
    elif [[ ! "$DEPLOYMENT_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        errors+=("DEPLOYMENT_PRIVATE_KEY has invalid format - should be 0x followed by 64 hex characters")
    fi
    
    if [ ${#errors[@]} -ne 0 ]; then
        echo -e "${RED}Configuration errors found:${NC}"
        for error in "${errors[@]}"; do
            echo "  ❌ $error"
        done
        echo
        echo -e "${YELLOW}Please update your .env file with the correct values.${NC}"
        exit 1
    fi
}

echo -e "${BLUE}🔧 Testnet USDC Setup (Base Sepolia + Arbitrum Sepolia)${NC}"
echo "======================================================="

# Validate addresses first
validate_addresses

# Load environment variables from .env file
load_env_file

# Validate configuration
validate_config

# Account configuration
DEPLOYMENT_KEY="$DEPLOYMENT_PRIVATE_KEY"
DEPLOYER_ADDRESS=$(cast wallet address --private-key $DEPLOYMENT_KEY)

# USDC Token addresses
ORIGIN_TOKEN="$ORIGIN_USDC_ADDRESS"
DEST_TOKEN="$DEST_USDC_ADDRESS"

# Contract addresses
ORIGIN_COMPACT_ADDRESS=""
ORIGIN_PERMIT2_ADDRESS="0x000000000022D473030F116dDEE9F6B43aC78BA3"
DEST_PERMIT2_ADDRESS="0x000000000022D473030F116dDEE9F6B43aC78BA3"
OIF_PINNED_COMMIT="f2a9e8ab9d652894a090814421a7acb9a0547737"

echo
echo -e "${GREEN}✅ Configuration validated${NC}"
echo "  Origin Chain:      Base Sepolia (Chain ID: $ORIGIN_CHAIN_ID)"
echo "  Destination Chain: Arbitrum Sepolia (Chain ID: $DEST_CHAIN_ID)"
echo "  Deployer Address:  $DEPLOYER_ADDRESS"
echo "  Solver Address:    $SOLVER_ADDRESS"
echo "  Asset:             USDC on both chains"
echo "  Origin USDC:       $ORIGIN_USDC_ADDRESS"
echo "  Destination USDC:  $DEST_USDC_ADDRESS"
echo

# Verify network connectivity
echo -e "${YELLOW}1. Verifying network connectivity...${NC}"
echo "  Debug: ORIGIN_RPC_URL = $ORIGIN_RPC_URL"
echo "  Debug: DEST_RPC_URL = $DEST_RPC_URL"
echo -n "  Testing Base Sepolia RPC... "

# Test if cast command exists
if ! command -v cast &> /dev/null; then
    echo -e "${RED}Failed${NC}"
    echo "Error: 'cast' command not found. Please install Foundry: https://getfoundry.sh/"
    exit 1
fi

# Test the RPC connection with more verbose output
if cast chain-id --rpc-url "$ORIGIN_RPC_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}Failed${NC}"
    echo "Debug: Trying to connect to: $ORIGIN_RPC_URL"
    echo "Debug: Cast command output:"
    cast chain-id --rpc-url "$ORIGIN_RPC_URL" 2>&1 || true
    echo "Please check your BASE_SEPOLIA_RPC_URL in the script configuration"
    exit 1
fi

echo -n "  Testing Arbitrum Sepolia RPC... "
if cast chain-id --rpc-url "$DEST_RPC_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}Failed${NC}"
    echo "Please check your ARBITRUM_SEPOLIA_RPC_URL in the script configuration"
    exit 1
fi

# Check deployer balances (ETH for gas + USDC for testing)
echo -e "${YELLOW}2. Checking deployer balances...${NC}"
DEPLOYER_ORIGIN_BALANCE=$(cast balance $DEPLOYER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" --ether 2>/dev/null || echo "0")
DEPLOYER_DEST_BALANCE=$(cast balance $DEPLOYER_ADDRESS --rpc-url "$DEST_RPC_URL" --ether 2>/dev/null || echo "0")

# Check USDC balances
DEPLOYER_ORIGIN_USDC=$(cast call $ORIGIN_USDC_ADDRESS "balanceOf(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")
DEPLOYER_DEST_USDC=$(cast call $DEST_USDC_ADDRESS "balanceOf(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url "$DEST_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")

echo "  Deployer Base Sepolia ETH:     ${DEPLOYER_ORIGIN_BALANCE} ETH"
echo "  Deployer Arbitrum Sepolia ETH: ${DEPLOYER_DEST_BALANCE} ETH"
echo "  Deployer Base Sepolia USDC:    ${DEPLOYER_ORIGIN_USDC} USDC"
echo "  Deployer Arbitrum Sepolia USDC: ${DEPLOYER_DEST_USDC} USDC"

# Check solver balances
echo -e "${YELLOW}3. Checking solver balances...${NC}"
SOLVER_ORIGIN_BALANCE=$(cast balance $SOLVER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" --ether 2>/dev/null || echo "0")
SOLVER_DEST_BALANCE=$(cast balance $SOLVER_ADDRESS --rpc-url "$DEST_RPC_URL" --ether 2>/dev/null || echo "0")

# Check solver USDC balances
SOLVER_ORIGIN_USDC=$(cast call $ORIGIN_USDC_ADDRESS "balanceOf(address)(uint256)" $SOLVER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")
SOLVER_DEST_USDC=$(cast call $DEST_USDC_ADDRESS "balanceOf(address)(uint256)" $SOLVER_ADDRESS --rpc-url "$DEST_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")

echo "  Solver Base Sepolia ETH:       ${SOLVER_ORIGIN_BALANCE} ETH"
echo "  Solver Arbitrum Sepolia ETH:   ${SOLVER_DEST_BALANCE} ETH"
echo "  Solver Base Sepolia USDC:      ${SOLVER_ORIGIN_USDC} USDC"
echo "  Solver Arbitrum Sepolia USDC:  ${SOLVER_DEST_USDC} USDC"

# Check if solver has sufficient balances for operation
MIN_SOLVER_USDC="1"  # Reduced from 10 to 1 since we're only sending 1 USDC
if (( $(echo "$SOLVER_DEST_USDC < $MIN_SOLVER_USDC" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Solver needs USDC on Arbitrum Sepolia to fulfill orders!${NC}"
    echo "   Solver address: $SOLVER_ADDRESS"
    echo "   Recommended: at least $MIN_SOLVER_USDC USDC for testing"
    echo "   Send USDC to this address before starting the solver"
    echo
fi

echo -e "${GREEN}✓${NC} Sufficient deployer balances for deployment"

# Step 4: Deploy contracts
echo
echo -e "${YELLOW}4. Deploying contracts...${NC}"

# Clone or update oif-contracts to specific commit
if [ ! -d "oif-contracts" ]; then
    echo -n "  Cloning oif-contracts... "
    git clone https://github.com/openintentsframework/oif-contracts.git > /dev/null 2>&1
    echo -e "${GREEN}✓${NC}"
fi

cd oif-contracts
echo -n "  Checking out oif-contracts commit ${OIF_PINNED_COMMIT}... "
git fetch origin > /dev/null 2>&1
git checkout ${OIF_PINNED_COMMIT} > /dev/null 2>&1
echo -e "${GREEN}✓${NC}"

# Deploy contracts on origin chain (Base Sepolia) using deployer key
echo -e "${BLUE}=== Base Sepolia Deployments ===${NC}"

# Deploy Oracle from actual contract
echo -n "  Deploying AlwaysYesOracle... "
ORACLE_OUTPUT=$(~/.foundry/bin/forge create test/mocks/AlwaysYesOracle.sol:AlwaysYesOracle \
    --rpc-url "$ORIGIN_RPC_URL" \
    --private-key $DEPLOYMENT_KEY \
    --broadcast 2>&1)
ORACLE=$(echo "$ORACLE_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
if [ -z "$ORACLE" ]; then
    echo -e "${RED}Failed to deploy oracle${NC}"
    echo "Oracle output: $ORACLE_OUTPUT"
    exit 1
fi
echo -e "${GREEN}✓${NC} $ORACLE"

# Deploy InputSettlerEscrow
echo -n "  Deploying InputSettlerEscrow... "
INPUT_SETTLER_OUTPUT=$(~/.foundry/bin/forge create src/input/escrow/InputSettlerEscrow.sol:InputSettlerEscrow \
    --rpc-url "$ORIGIN_RPC_URL" \
    --private-key $DEPLOYMENT_KEY \
    --broadcast 2>&1)
INPUT_SETTLER=$(echo "$INPUT_SETTLER_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
if [ -z "$INPUT_SETTLER" ]; then
    echo -e "${RED}Failed to deploy InputSettler${NC}"
    echo "InputSettler output: $INPUT_SETTLER_OUTPUT"
    exit 1
fi
echo -e "${GREEN}✓${NC} $INPUT_SETTLER"

# Deploy OutputSettler on destination chain (Arbitrum Sepolia) using deployer key
echo
echo -e "${BLUE}=== Arbitrum Sepolia Deployments ===${NC}"

echo -n "  Deploying OutputSettler... "
OUTPUT_SETTLER_OUTPUT=$(~/.foundry/bin/forge create src/output/coin/OutputSettler7683.sol:OutputInputSettlerEscrow \
    --rpc-url "$DEST_RPC_URL" \
    --private-key $DEPLOYMENT_KEY \
    --broadcast 2>&1)
OUTPUT_SETTLER=$(echo "$OUTPUT_SETTLER_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
if [ -z "$OUTPUT_SETTLER" ]; then
    echo -e "${RED}Failed to deploy OutputSettler${NC}"
    echo "OutputSettler output: $OUTPUT_SETTLER_OUTPUT"
    exit 1
fi
echo -e "${GREEN}✓${NC} $OUTPUT_SETTLER"

cd ..

# Step 5: Create modular config files
echo
echo -e "${YELLOW}5. Creating modular config files...${NC}"

mkdir -p config/testnet

# Create main config file with includes
cat > config/testnet.toml << EOF
# OIF Solver Configuration - Testnet USDC Setup

include = [
    "testnet/networks.toml",
    "testnet/api.toml"
]

[solver]
id = "oif-solver-testnet-usdc"
monitoring_timeout_minutes = 5

# ============================================================================
# STORAGE
# ============================================================================
[storage]
primary = "file"
cleanup_interval_seconds = 3600

[storage.implementations.memory]
# Memory storage has no configuration

[storage.implementations.file]
storage_path = "./data/storage"
ttl_orders = 0                  # Permanent
ttl_intents = 86400             # 24 hours
ttl_order_by_tx_hash = 86400    # 24 hours

# ============================================================================
# ACCOUNT
# ============================================================================
[account]
primary = "local"

[account.implementations.local]
private_key = "$SOLVER_PRIVATE_KEY"

# ============================================================================
# DELIVERY
# ============================================================================
[delivery]
min_confirmations = 3  # Higher confirmations for testnets

[delivery.implementations.evm_alloy]
network_ids = [$ORIGIN_CHAIN_ID, $DEST_CHAIN_ID]

# ============================================================================
# DISCOVERY
# ============================================================================
[discovery]

[discovery.implementations.onchain_eip7683]
network_ids = [$ORIGIN_CHAIN_ID, $DEST_CHAIN_ID]

[discovery.implementations.offchain_eip7683]
api_host = "127.0.0.1"
api_port = 8081
network_ids = [$ORIGIN_CHAIN_ID]

# ============================================================================
# ORDER
# ============================================================================
[order]

[order.implementations.eip7683]

[order.strategy]
primary = "simple"

[order.strategy.implementations.simple]
max_gas_price_gwei = 100

# ============================================================================
# SETTLEMENT
# ============================================================================
[settlement]

[settlement.domain]
chain_id = 1
address = "$INPUT_SETTLER"

[settlement.implementations.eip7683]
network_ids = [$ORIGIN_CHAIN_ID, $DEST_CHAIN_ID]
oracle_addresses = { $ORIGIN_CHAIN_ID = "$ORACLE", $DEST_CHAIN_ID = "$ORACLE" }
dispute_period_seconds = 60


# ============================================================================
# DEMO SCRIPT CONFIGURATION
# The following sections are used by demo scripts (send_onchain_intent.sh, etc.)
# and are NOT required by the solver itself. The solver only needs the
# configurations above.
# ============================================================================

# Contract addresses for testing (used by demo scripts)
[contracts.origin]
USDC = "$ORIGIN_USDC_ADDRESS"
permit2 = "$ORIGIN_PERMIT2_ADDRESS"

[contracts.destination]
USDC = "$DEST_USDC_ADDRESS"
permit2 = "$DEST_PERMIT2_ADDRESS"

# Test accounts (used by demo scripts)
[accounts]
solver = "$SOLVER_ADDRESS"
user = "$USER_ADDRESS"
user_private_key = "$USER_PRIVATE_KEY"
recipient = "$DEST_RECIPIENT_ADDR"
EOF

# Create networks.toml
cat > config/testnet/networks.toml << EOF
# Network Configuration - Testnet Setup
# Defines all supported blockchain networks and their tokens

[networks.$ORIGIN_CHAIN_ID]
rpc_url = "$ORIGIN_RPC_URL"
input_settler_address = "$INPUT_SETTLER"
output_settler_address = "$OUTPUT_SETTLER"

[[networks.$ORIGIN_CHAIN_ID.tokens]]
address = "$ORIGIN_USDC_ADDRESS"
symbol = "USDC"
decimals = 6

[networks.$DEST_CHAIN_ID]
rpc_url = "$DEST_RPC_URL"
input_settler_address = "$INPUT_SETTLER"
output_settler_address = "$OUTPUT_SETTLER"

[[networks.$DEST_CHAIN_ID.tokens]]
address = "$DEST_USDC_ADDRESS"
symbol = "USDC"
decimals = 6
EOF

# Create api.toml
cat > config/testnet/api.toml << EOF
# API Server Configuration - Testnet Setup
# Configures the HTTP API for receiving off-chain intents

[api]
enabled = true
host = "127.0.0.1"
port = 3000
timeout_seconds = 30
max_request_size = 1048576  # 1MB
EOF

# Done!
echo
echo -e "${GREEN}✅ Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "${BLUE}🔗 Networks:${NC}"
echo "  Origin:      Base Sepolia (Chain ID: $ORIGIN_CHAIN_ID)"
echo "  Destination: Arbitrum Sepolia (Chain ID: $DEST_CHAIN_ID)"
echo
echo -e "${BLUE}🌐 RPC Endpoints:${NC}"
echo "  Base Sepolia:     $ORIGIN_RPC_URL"
echo "  Arbitrum Sepolia: $DEST_RPC_URL"
echo
echo -e "${BLUE}💎 Asset:${NC}"
echo "  USDC on both chains"
echo "  Origin USDC:      $ORIGIN_USDC_ADDRESS"
echo "  Destination USDC: $DEST_USDC_ADDRESS"
echo
echo -e "${BLUE}📋 Contracts:${NC}"
echo "  Base Sepolia:"
echo "    InputSettler: $INPUT_SETTLER"
echo "    Oracle:       $ORACLE"
echo "    USDC Token:   $ORIGIN_USDC_ADDRESS"
echo "  Arbitrum Sepolia:"
echo "    OutputSettler: $OUTPUT_SETTLER"
echo "    USDC Token:    $DEST_USDC_ADDRESS"
echo
echo -e "${BLUE}👥 Addresses:${NC}"
echo "  Deployer (MetaMask): $DEPLOYER_ADDRESS"
echo "  Solver (Defined):  $SOLVER_ADDRESS"
echo "  User (Defined):   $USER_ADDRESS"
echo
echo -e "${BLUE}💰 Current Balances:${NC}"
echo "  Deployer Base Sepolia ETH:     ${DEPLOYER_ORIGIN_BALANCE} ETH"
echo "  Deployer Arbitrum Sepolia ETH: ${DEPLOYER_DEST_BALANCE} ETH"
echo "  Deployer Base Sepolia USDC:    ${DEPLOYER_ORIGIN_USDC} USDC"
echo "  Deployer Arbitrum Sepolia USDC: ${DEPLOYER_DEST_USDC} USDC"
echo "  Solver Base Sepolia ETH:       ${SOLVER_ORIGIN_BALANCE} ETH"
echo "  Solver Arbitrum Sepolia ETH:   ${SOLVER_DEST_BALANCE} ETH"
echo "  Solver Base Sepolia USDC:      ${SOLVER_ORIGIN_USDC} USDC"
echo "  Solver Arbitrum Sepolia USDC:  ${SOLVER_DEST_USDC} USDC"
echo
echo -e "${BLUE}📋 Files Created:${NC}"
echo "  Main Config:    config/testnet.toml"
echo "  Networks:       config/testnet/networks.toml" 
echo "  API:            config/testnet/api.toml"
echo

echo -e "${YELLOW}To start the solver:${NC}"
echo "  cargo run --bin solver-service -- --config config/testnet.toml"
echo

echo -e "${BLUE}💡 Next Steps:${NC}"
echo "  1. SAVE the solver keypair shown above!"
echo "  2. Fund the solver address with USDC on Arbitrum Sepolia:"
echo "     Address: $SOLVER_ADDRESS"
echo "     Recommended: at least $MIN_SOLVER_USDC USDC for testing"
echo "  3. Ensure you have USDC on Base Sepolia for test transactions (need >1 USDC)"
echo "  4. VERIFY the USDC token address on Arbitrum Sepolia"
echo "     Check https://sepolia.arbiscan.io/ for the correct address"
echo "  5. Start the solver service"
echo
echo -e "${BLUE}💡 Getting Testnet USDC:${NC}"
echo "  Base Sepolia USDC: Bridge from Ethereum Sepolia using https://bridge.base.org/"
echo "  Arbitrum Sepolia USDC: Bridge from Base/Ethereum using https://bridge.arbitrum.io/"
echo "  Alternative: Deploy your own test USDC token on Arbitrum Sepolia"
echo
echo -e "${GREEN}🎉 Testnet setup completed!${NC}"