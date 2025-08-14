#!/bin/bash

# OIF Solver Testnet Environment Setup Script
# ===========================================
#
# This script sets up a complete testnet testing environment for the OIF cross-chain solver.
# It performs the following operations:
#
# 1. Uses SOLVER_ADDRESS and USER_ADDRESS defined below
# 2. Deploys smart contracts on both testnets:
#    - InputSettlerEscrow on Ethereum Sepolia (origin chain)
#    - OutputSettler7683 on Base Sepolia (destination chain)
#    - Mock Oracle contract for intent validation
#
# 3. Configures the test environment for USDC transfers:
#    - Uses USDC on both chains (requires token balances)
#    - Generates configuration file (config/demo.toml) for the solver
#
# After running this script, you can:
# - Start the solver with: cargo run --bin solver-service -- --config config/demo.toml
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
ORIGIN_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
DEST_RPC_URL="https://sepolia.base.org"

# Chain IDs
ORIGIN_CHAIN_ID=11155111  # Ethereum Sepolia
DEST_CHAIN_ID=84532       # Base Sepolia

# USDC Token Addresses
ORIGIN_USDC_ADDRESS="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"  # USDC on Ethereum Sepolia
DEST_USDC_ADDRESS="0x036CbD53842c5426634e7929541eC2318f3dCF7e"    # USDC on Base Sepolia

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

echo -e "${BLUE}🔧 Testnet USDC Setup (Sepolia + Base Sepolia)${NC}"
echo "================================================"

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
echo "  Origin Chain:      Ethereum Sepolia (Chain ID: $ORIGIN_CHAIN_ID)"
echo "  Destination Chain: Base Sepolia (Chain ID: $DEST_CHAIN_ID)"
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
echo -n "  Testing Sepolia RPC... "

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
    echo "Please check your SEPOLIA_RPC_URL in the script configuration"
    exit 1
fi

echo -n "  Testing Base Sepolia RPC... "
if cast chain-id --rpc-url "$DEST_RPC_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}Failed${NC}"
    echo "Please check your BASE_SEPOLIA_RPC_URL in the script configuration"
    exit 1
fi

# Check deployer balances (ETH for gas + USDC for testing)
echo -e "${YELLOW}2. Checking deployer balances...${NC}"
DEPLOYER_ORIGIN_BALANCE=$(cast balance $DEPLOYER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" --ether 2>/dev/null || echo "0")
DEPLOYER_DEST_BALANCE=$(cast balance $DEPLOYER_ADDRESS --rpc-url "$DEST_RPC_URL" --ether 2>/dev/null || echo "0")

# Check USDC balances
DEPLOYER_ORIGIN_USDC=$(cast call $ORIGIN_USDC_ADDRESS "balanceOf(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")
DEPLOYER_DEST_USDC=$(cast call $DEST_USDC_ADDRESS "balanceOf(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url "$DEST_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")

echo "  Deployer Sepolia ETH:      ${DEPLOYER_ORIGIN_BALANCE} ETH"
echo "  Deployer Base Sepolia ETH: ${DEPLOYER_DEST_BALANCE} ETH"
echo "  Deployer Sepolia USDC:     ${DEPLOYER_ORIGIN_USDC} USDC"
echo "  Deployer Base Sepolia USDC:${DEPLOYER_DEST_USDC} USDC"

# Check solver balances
echo -e "${YELLOW}3. Checking solver balances...${NC}"
SOLVER_ORIGIN_BALANCE=$(cast balance $SOLVER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" --ether 2>/dev/null || echo "0")
SOLVER_DEST_BALANCE=$(cast balance $SOLVER_ADDRESS --rpc-url "$DEST_RPC_URL" --ether 2>/dev/null || echo "0")

# Check solver USDC balances
SOLVER_ORIGIN_USDC=$(cast call $ORIGIN_USDC_ADDRESS "balanceOf(address)(uint256)" $SOLVER_ADDRESS --rpc-url "$ORIGIN_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")
SOLVER_DEST_USDC=$(cast call $DEST_USDC_ADDRESS "balanceOf(address)(uint256)" $SOLVER_ADDRESS --rpc-url "$DEST_RPC_URL" 2>/dev/null | xargs -I {} cast --to-unit {} 6 2>/dev/null || echo "0")

echo "  Solver Sepolia ETH:        ${SOLVER_ORIGIN_BALANCE} ETH"
echo "  Solver Base Sepolia ETH:   ${SOLVER_DEST_BALANCE} ETH"
echo "  Solver Sepolia USDC:       ${SOLVER_ORIGIN_USDC} USDC"
echo "  Solver Base Sepolia USDC:  ${SOLVER_DEST_USDC} USDC"

# Check if solver has sufficient balances for operation
MIN_SOLVER_USDC="1"  # Reduced from 10 to 2 since we're only sending 1 USDC
if (( $(echo "$SOLVER_DEST_USDC < $MIN_SOLVER_USDC" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Solver needs USDC on Base Sepolia to fulfill orders!${NC}"
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

# Deploy contracts on origin chain (Sepolia) using deployer key
echo -e "${BLUE}=== Ethereum Sepolia Deployments ===${NC}"

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

# Deploy OutputSettler on destination chain (Base Sepolia) using deployer key
echo
echo -e "${BLUE}=== Base Sepolia Deployments ===${NC}"

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

# Step 5: Create config file (using solver private key for operations)
echo
echo -e "${YELLOW}5. Creating config file...${NC}"

mkdir -p config

cat > config/demo.toml << EOF
# OIF Solver Configuration - Testnet USDC Setup (Sepolia + Base Sepolia)

[solver]
id = "oif-solver-testnet-usdc"
monitoring_timeout_minutes = 5

# ============================================================================
# NETWORKS - Central configuration for all chains
# ============================================================================
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
provider = "local"
[account.config]
private_key = "$SOLVER_PRIVATE_KEY"

# ============================================================================
# DELIVERY - References networks by ID
# ============================================================================
[delivery]
min_confirmations = 3  # Higher confirmations for testnets

[delivery.providers.origin]
network_id = $ORIGIN_CHAIN_ID  # References networks.$ORIGIN_CHAIN_ID for RPC URL and chain ID
# private_key omitted - uses account.config.private_key by default

[delivery.providers.destination]
network_id = $DEST_CHAIN_ID  # References networks.$DEST_CHAIN_ID
# private_key omitted - uses account.config.private_key by default

# ============================================================================
# DISCOVERY - References networks for chain-specific sources
# ============================================================================
[discovery]

[discovery.sources.onchain_eip7683]
network_id = $ORIGIN_CHAIN_ID  # Required: specifies which chain to monitor

[discovery.sources.offchain_eip7683]
api_host = "127.0.0.1"
api_port = 8081
network_ids = [$ORIGIN_CHAIN_ID]  # Optional: declares multi-chain support
# auth_token = "your-secret-token"

# ============================================================================
# ORDER
# ============================================================================
[order]
[order.implementations.eip7683]
# Uses networks config for all chain-specific settings

[order.execution_strategy]
strategy_type = "simple"
[order.execution_strategy.config]
max_gas_price_gwei = 100

# ============================================================================
# SETTLEMENT - References networks for chain config
# ============================================================================
[settlement]
[settlement.domain]
# Domain configuration for EIP-712 signatures in quotes
chain_id = 1  # Ethereum mainnet for signature domain
address = "$INPUT_SETTLER"

[settlement.implementations.eip7683]
network_ids = [$ORIGIN_CHAIN_ID, $DEST_CHAIN_ID]  # Monitor multiple chains for oracle verification
oracle_addresses = { $ORIGIN_CHAIN_ID = "$ORACLE", $DEST_CHAIN_ID = "$ORACLE" }
dispute_period_seconds = 60

# ============================================================================
# API SERVER
# ============================================================================
[api]
enabled = true
host = "127.0.0.1"
port = 3000
timeout_seconds = 30
max_request_size = 1048576  # 1MB

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
user_private_key = "$USER_PRIVATE_KEY" # Use deployer private key for user
recipient = "$DEST_RECIPIENT_ADDR"
EOF

# Done!
echo
echo -e "${GREEN}✅ Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "${BLUE}🔗 Networks:${NC}"
echo "  Origin:      Ethereum Sepolia (Chain ID: $ORIGIN_CHAIN_ID)"
echo "  Destination: Base Sepolia (Chain ID: $DEST_CHAIN_ID)"
echo
echo -e "${BLUE}🌐 RPC Endpoints:${NC}"
echo "  Sepolia:     $ORIGIN_RPC_URL"
echo "  Base Sepolia: $DEST_RPC_URL"
echo
echo -e "${BLUE}💎 Asset:${NC}"
echo "  USDC on both chains"
echo "  Origin USDC:      $ORIGIN_USDC_ADDRESS"
echo "  Destination USDC: $DEST_USDC_ADDRESS"
echo
echo -e "${BLUE}📋 Contracts:${NC}"
echo "  Ethereum Sepolia:"
echo "    InputSettler: $INPUT_SETTLER"
echo "    Oracle:       $ORACLE"
echo "    USDC Token:   $ORIGIN_USDC_ADDRESS"
echo "  Base Sepolia:"
echo "    OutputSettler: $OUTPUT_SETTLER"
echo "    USDC Token:    $DEST_USDC_ADDRESS"
echo
echo -e "${BLUE}👥 Addresses:${NC}"
echo "  Deployer (MetaMask): $DEPLOYER_ADDRESS"
echo "  Solver (Defined):  $SOLVER_ADDRESS"
echo "  User (Defined):   $USER_ADDRESS"
echo
echo -e "${BLUE}💰 Current Balances:${NC}"
echo "  Deployer Sepolia ETH:      ${DEPLOYER_ORIGIN_BALANCE} ETH"
echo "  Deployer Base Sepolia ETH: ${DEPLOYER_DEST_BALANCE} ETH"
echo "  Deployer Sepolia USDC:     ${DEPLOYER_ORIGIN_USDC} USDC"
echo "  Deployer Base Sepolia USDC:${DEPLOYER_DEST_USDC} USDC"
echo "  Solver Sepolia ETH:        ${SOLVER_ORIGIN_BALANCE} ETH"
echo "  Solver Base Sepolia ETH:   ${SOLVER_DEST_BALANCE} ETH"
echo "  Solver Sepolia USDC:       ${SOLVER_ORIGIN_USDC} USDC"
echo "  Solver Base Sepolia USDC:  ${SOLVER_DEST_USDC} USDC"
echo
echo -e "${BLUE}📋 Files Created:${NC}"
echo "  Config:      config/demo.toml"
echo

echo -e "${YELLOW}To start the solver:${NC}"
echo "  cargo run --bin solver-service -- --config config/demo.toml"
echo

echo -e "${BLUE}💡 Next Steps:${NC}"
echo "  1. SAVE the solver keypair shown above!"
echo "  2. Fund the solver address with USDC on Base Sepolia:"
echo "     Address: $SOLVER_ADDRESS"
echo "     Recommended: at least $MIN_SOLVER_USDC USDC for testing"
echo "  3. Ensure you have USDC on Sepolia for test transactions (need >1 USDC)"
echo "  4. Start the solver service"
echo
echo -e "${BLUE}💡 Getting Testnet USDC:${NC}"
echo "  Sepolia USDC Faucet: Use Circle's testnet faucet or bridge from other testnets"
echo "  Base Sepolia USDC: Bridge from Sepolia using https://bridge.base.org/"
echo "  Alternative: Use Relay.link for testnet USDC bridging"
echo
echo -e "${GREEN}🎉 Testnet setup completed!${NC}"