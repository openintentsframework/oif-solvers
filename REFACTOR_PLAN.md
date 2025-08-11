# Multi-Network Token Configuration Refactor Plan

## Overview
This document outlines the refactoring plan to support multiple networks, multiple tokens, and dynamic routing in the OIF solver. The current implementation is limited to single token, single input/output settler on 2 individual networks. This refactor will enable full multi-chain, multi-token support.

## Refactor Rules & Principles

### Core Rules (MUST follow)
1. **No backwards compatibility** - Break anything needed, existing configs will need updating
2. **No tests** - Do not write or worry about tests during implementation
3. **Keep it stupidly simple** - Avoid over-engineering, use simplest approach that works
4. **Maintain current patterns** - Follow existing code patterns and architecture
5. **No placeholders** - Avoid "TODO" comments or "in a real implementation..." notes
6. **Direct implementation** - Write actual working code, not abstractions for future use

### Implementation Guidelines
- Use existing services (DeliveryService, AccountService) as-is
- Don't create new abstractions unless absolutely necessary
- Prefer direct field access over complex getters/setters
- Keep error handling simple and consistent with existing code
- Don't optimize prematurely - make it work first

## Critical Requirements (MUST be enforced)

1. **Networks Configuration**
   - Networks configuration MUST NOT be empty
   - At least 2 different networks (chain_ids) MUST be configured
   - Each network MUST have both `input_settler_address` and `output_settler_address`
   - Each network MUST have at least 1 token configured

2. **Configuration Changes**
   - Remove ALL dependencies on standalone `settler_address` fields
   - Discovery and order modules MUST use networks config for settler lookups
   - Chain ID MUST be used to determine appropriate settler addresses

3. **Token Manager**
   - MUST ensure MAX_UINT256 approvals for all tokens at startup
   - MUST use delivery service for balance/allowance checks
   - MUST use account service to fetch solver address
   - MUST provide helper functions for token/network validation

4. **Factory Functions Updates**
   - All factory functions in `solver-service/src/main.rs` must be updated to pass networks config
   - Discovery factories must extract `chain_id` from TOML config and pass both networks and chain_id
   - Order factory must pass entire networks config instead of individual settler addresses

## Configuration Format

```toml
[[networks.31337]]
input_settler_address = "0x..."
output_settler_address = "0x..."
  
[[networks.31337.tokens]]
address = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
symbol = "USDC"
decimals = 18

[[networks.31337.tokens]]
address = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
symbol = "USDT"
decimals = 6

[[networks.31338]]
input_settler_address = "0x..."
output_settler_address = "0x..."

[[networks.31338.tokens]]
address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
symbol = "USDC"
decimals = 18
```

## Phase 1: Configuration Layer Refactor

### Step 1.1: Create Network/Token Types in solver-types
**Location**: Create new file `crates/solver-types/src/networks.rs`

**New Types**:
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::Address;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TokenConfig {
    pub address: Address,
    pub symbol: String,
    pub decimals: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NetworkConfig {
    pub chain_id: u64,
    pub input_settler_address: Address,
    pub output_settler_address: Address,
    pub tokens: Vec<TokenConfig>,
}

pub type NetworksConfig = HashMap<u64, NetworkConfig>;
```

**Add to** `crates/solver-types/src/lib.rs`:
```rust
pub mod networks;
pub use networks::{TokenConfig, NetworkConfig, NetworksConfig};
```

**Validation Methods**:
- Will be implemented in solver-config validation, not here

### Step 1.2: Update solver-config
**Location**: `crates/solver-config/src/lib.rs`

**Changes**:
1. Add `networks: HashMap<u64, NetworkConfig>` to main `Config` struct
2. Implement validation in `Config::validate()`:
   - Check networks.len() >= 2
   - Verify each network has both settlers
   - Ensure each network has tokens.len() >= 1
3. Remove `settler_address` fields from discovery/order configs

### Step 1.3: Refactor Discovery Modules

**Key Decision**: Like delivery providers, discovery sources need explicit `chain_id` in config since we cannot reliably extract it from RPC URL. The `origin_chain_id` in order data is different - it's where the user deposits, not necessarily where we're monitoring.

#### Onchain Discovery
**Location**: `crates/solver-discovery/src/implementations/onchain/_7683.rs`

**Config Change**:
```toml
[discovery.sources.onchain_origin]
rpc_url = "http://localhost:8545"
chain_id = 31337  # MUST specify which chain we're monitoring
```

**Code Changes**:
1. Accept `NetworksConfig` and `chain_id` in constructor
2. Remove `settler_addresses` parameter
3. Use `networks[chain_id].input_settler_address` for monitoring
4. Update factory function to extract chain_id from config

#### Offchain Discovery  
**Location**: `crates/solver-discovery/src/implementations/offchain/_7683.rs`

**Config Change**:
```toml
[discovery.sources.offchain_origin]
rpc_url = "http://localhost:8545"
chain_id = 31337  # Chain where settler contract is deployed
```

**Code Changes**:
1. Accept `NetworksConfig` and `chain_id` in constructor
2. Remove `settler_address` parameter
3. Use `networks[chain_id].input_settler_address` for validation
4. Update factory function to extract chain_id from config

### Step 1.4: Refactor Order Module
**Location**: `crates/solver-order/src/implementations/standards/_7683.rs`

**Changes**:
1. Replace fixed `input_settler_address` and `output_settler_address` with `NetworksConfig`
2. Store networks config in `Eip7683OrderImpl` struct
3. In transaction generation methods:
   - `generate_prepare_transaction()`: Use `order_data.origin_chain_id` → `networks[chain_id].input_settler_address`
   - `generate_fill_transaction()`: Use `output.chain_id` → `networks[chain_id].output_settler_address`
   - `generate_claim_transaction()`: Use `order_data.origin_chain_id` → `networks[chain_id].input_settler_address`
4. Update factory function in `crates/solver-order/src/implementations/standards/_7683.rs::create_order_impl()` to:
   - Accept networks config from main config
   - Pass it to constructor instead of individual settler addresses

### Step 1.5: Update Settlement Module
**Location**: `crates/solver-settlement/src/implementations/direct.rs`

**Changes**:
- May need `NetworksConfig` for multi-chain settlement validation
- Currently uses `oracle_address` which remains unchanged
- Update if chain-specific oracles are needed in future

### Step 1.6: Update demo.toml Generation
**Location**: `scripts/demo/setup_local_anvil.sh`

**Changes**:
1. Generate networks sections instead of individual settler addresses:
   ```toml
   [networks.31337]
   input_settler_address = "$INPUT_SETTLER"
   output_settler_address = "$OUTPUT_SETTLER"
   [[networks.31337.tokens]]
   address = "$TOKEN_ORIGIN"
   symbol = "TEST"
   decimals = 18
   
   [networks.31338]
   input_settler_address = "$INPUT_SETTLER"
   output_settler_address = "$OUTPUT_SETTLER"
   [[networks.31338.tokens]]
   address = "$TOKEN_DEST"
   symbol = "TEST"
   decimals = 18
   ```
2. Update discovery sources to include chain_id:
   ```toml
   [discovery.sources.onchain_eip7683]
   rpc_url = "http://localhost:8545"
   chain_id = 31337
   
   [discovery.sources.offchain_eip7683]
   rpc_url = "http://localhost:8545"
   chain_id = 31337
   ```
3. Remove old `settler_address` lines from discovery/order sections

## Phase 2: Token Manager Implementation

### Step 2.1: Add get_allowance to DeliveryInterface
**Location**: `crates/solver-delivery/src/lib.rs`

**Add Method**:
```rust
async fn get_allowance(
    &self,
    chain_id: u64,
    owner: &str,
    spender: &str, 
    token_address: &str,
) -> Result<String, DeliveryError>;
```

**Implementation**: Similar to `get_balance`, make ERC20 allowance call

### Step 2.2: Create TokenManager
**Location**: `crates/solver-core/src/engine/token_manager.rs` (new file)

**Structure**:
```rust
use solver_types::{NetworksConfig, TokenConfig, Address};
use solver_delivery::DeliveryService;
use solver_account::AccountService;
use std::sync::Arc;
use std::collections::HashMap;

pub struct TokenManager {
    networks: NetworksConfig,
    delivery: Arc<DeliveryService>,
    account: Arc<AccountService>,
}

impl TokenManager {
    pub fn new(
        networks: NetworksConfig,
        delivery: Arc<DeliveryService>,
        account: Arc<AccountService>,
    ) -> Self {
        Self { networks, delivery, account }
    }
    
    // Methods below...
}
```

### Step 2.3: Implement Core Functions

**Methods**:
1. `ensure_approvals()`: 
   - Get solver address from account service
   - Iterate all networks and tokens
   - Check current allowances via `delivery.get_allowance()`
   - Submit approve(MAX_UINT256) transactions where needed
   - Wait for confirmations

2. `check_balances()`:
   - Get solver address from account service
   - Query balances for all configured tokens across networks
   - Return HashMap<(chain_id, token_address), balance>

3. `is_supported(chain_id, token_address)`:
   - Check if token exists in networks[chain_id].tokens
   - Return boolean

4. `get_token_info(chain_id, token_address)`:
   - Return TokenConfig if found
   - Return error if not supported

### Step 2.4: Integrate with ContextBuilder
**Location**: `crates/solver-core/src/engine/context.rs`

**Changes**:
1. Add `token_manager: Arc<TokenManager>` to ContextBuilder
2. Replace `get_common_tokens_for_chain()` with token manager lookups
3. Use `token_manager.check_balances()` for solver balance fetching
4. Pass token support info to execution strategy

### Step 2.5: Add to Engine Initialization
**Location**: `crates/solver-core/src/engine/mod.rs`

**Changes**:
1. Import TokenManager: `mod token_manager; use token_manager::TokenManager;`
2. In `SolverEngine::new()` or initialization:
   ```rust
   let token_manager = Arc::new(TokenManager::new(
       config.networks.clone(),
       delivery_service.clone(),
       account_service.clone(),
   ));
   
   // Call ensure approvals during startup
   token_manager.ensure_approvals().await?;
   ```
3. Pass token_manager to ContextBuilder when creating it
4. Store token_manager in SolverEngine if needed for handlers

## Factory Function Changes

### Discovery Factory Updates

**Before** (`solver-discovery/src/implementations/onchain/_7683.rs`):
```rust
pub fn create_discovery(config: &toml::Value) -> Result<Box<dyn DiscoveryInterface>, DiscoveryError> {
    let rpc_url = config.get("rpc_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| DiscoveryError::ValidationError("Missing rpc_url".into()))?;
    
    let settler_addresses = config.get("settler_addresses")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .ok_or_else(|| DiscoveryError::ValidationError("Missing settler_addresses".into()))?;
    
    let discovery = Eip7683Discovery::new(rpc_url, settler_addresses, None)?;
    Ok(Box::new(discovery))
}
```

**After** (with networks config):
```rust
pub fn create_discovery(
    config: &toml::Value,
    networks: &NetworksConfig,
) -> Result<Box<dyn DiscoveryInterface>, DiscoveryError> {
    let rpc_url = config.get("rpc_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| DiscoveryError::ValidationError("Missing rpc_url".into()))?;
    
    let chain_id = config.get("chain_id")
        .and_then(|v| v.as_integer())
        .ok_or_else(|| DiscoveryError::ValidationError("Missing chain_id".into()))? as u64;
    
    let discovery = Eip7683Discovery::new(rpc_url, chain_id, networks.clone(), None)?;
    Ok(Box::new(discovery))
}
```

### Order Factory Updates

**Before** (`solver-order/src/implementations/standards/_7683.rs`):
```rust
pub fn create_order_impl(config: &toml::Value) -> Result<Box<dyn OrderInterface>, OrderError> {
    let output_settler = config.get("output_settler_address")
        .and_then(|v| v.as_str())
        .ok_or_else(|| OrderError::ValidationFailed("Missing output_settler_address".into()))?;
    
    let input_settler = config.get("input_settler_address")
        .and_then(|v| v.as_str())
        .ok_or_else(|| OrderError::ValidationFailed("Missing input_settler_address".into()))?;
    
    Ok(Box::new(Eip7683OrderImpl::new(output_settler, input_settler)))
}
```

**After** (with networks config):
```rust
pub fn create_order_impl(
    _config: &toml::Value,  // Config may be empty now
    networks: &NetworksConfig,
) -> Result<Box<dyn OrderInterface>, OrderError> {
    Ok(Box::new(Eip7683OrderImpl::new(networks.clone())))
}
```

### Main.rs Builder Updates

**Before** (`solver-service/src/main.rs`):
```rust
async fn build_solver(config: Config) -> Result<SolverEngine, Box<dyn std::error::Error>> {
    let builder = SolverBuilder::new(config);
    
    let discovery_factories = create_factory_map!(
        solver_discovery::DiscoveryInterface,
        solver_discovery::DiscoveryError,
        "onchain_eip7683" => onchain_create_discovery,
        "offchain_eip7683" => offchain_create_discovery,
    );
    
    let order_factories = create_factory_map!(
        solver_order::OrderInterface,
        solver_order::OrderError,
        "eip7683" => create_order_impl,
    );
    
    // Build with factories...
}
```

**After** (with networks config):
```rust
async fn build_solver(config: Config) -> Result<SolverEngine, Box<dyn std::error::Error>> {
    let networks = config.networks.clone();
    let builder = SolverBuilder::new(config);
    
    // Discovery factories now need networks config
    let discovery_factories = {
        let networks = networks.clone();
        let mut factories = HashMap::new();
        
        factories.insert(
            "onchain_eip7683".to_string(),
            Box::new(move |cfg: &toml::Value| {
                onchain_create_discovery(cfg, &networks)
            }) as Box<dyn Fn(&toml::Value) -> Result<Box<dyn DiscoveryInterface>, DiscoveryError>>
        );
        
        factories.insert(
            "offchain_eip7683".to_string(),
            Box::new(move |cfg: &toml::Value| {
                offchain_create_discovery(cfg, &networks)
            }) as Box<dyn Fn(&toml::Value) -> Result<Box<dyn DiscoveryInterface>, DiscoveryError>>
        );
        
        factories
    };
    
    // Order factories now need networks config
    let order_factories = {
        let networks = networks.clone();
        let mut factories = HashMap::new();
        
        factories.insert(
            "eip7683".to_string(),
            Box::new(move |cfg: &toml::Value| {
                create_order_impl(cfg, &networks)
            }) as Box<dyn Fn(&toml::Value) -> Result<Box<dyn OrderInterface>, OrderError>>
        );
        
        factories
    };
    
    // Build with factories...
}
```

## Implementation Order

1. **Create shared types** (solver-types)
2. **Update configuration** (solver-config) 
3. **Refactor discovery modules** (pass networks, use chain_id lookups)
4. **Refactor order module** (use networks for dynamic settler addresses)
5. **Update settlement if needed**
6. **Update setup script** (setup_local_anvil.sh)
7. **Add get_allowance to delivery interface**
8. **Create TokenManager** (solver-core)
9. **Integrate TokenManager** with existing components
10. **Run demo to verify it works**

## Migration Notes

- This is a breaking change - existing configs will need updating
- No backwards compatibility maintained (as requested)
- All modules depending on settler addresses must be updated simultaneously

## Success Criteria

- [x] Plan documented and reviewed
- [ ] Networks configuration validates correctly
- [ ] Discovery works with dynamic settler lookup
- [ ] Orders use correct settlers per chain
- [ ] Token manager ensures approvals
- [ ] Multi-network demo works end-to-end
- [ ] Demo script generates correct config