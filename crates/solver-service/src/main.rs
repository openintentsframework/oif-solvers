//! Main entry point for the OIF solver service.
//!
//! This binary provides a complete solver implementation that discovers,
//! validates, executes, and settles cross-chain orders. It uses a modular
//! architecture with pluggable implementations for different components.

use clap::Parser;
use solver_config::Config;
use solver_core::{SolverBuilder, SolverEngine, SolverFactories};
use std::path::PathBuf;
use std::sync::Arc;

mod apis;
mod server;

// Import implementations from individual crates
use solver_account::implementations::local::create_account;
use solver_delivery::implementations::evm::alloy::create_http_delivery;
use solver_discovery::implementations::offchain::_7683::create_discovery as offchain_create_discovery;
use solver_discovery::implementations::onchain::_7683::create_discovery as onchain_create_discovery;
use solver_order::implementations::{
	standards::_7683::create_order_impl, strategies::simple::create_strategy,
};
use solver_settlement::implementations::direct::create_settlement;
use solver_storage::implementations::file::create_storage as create_file_storage;
use solver_storage::implementations::memory::create_storage as create_memory_storage;

/// Command-line arguments for the solver service.
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
	/// Path to configuration file
	#[arg(short, long, default_value = "config.toml")]
	config: PathBuf,

	/// Log level (trace, debug, info, warn, error)
	#[arg(short, long, default_value = "info")]
	log_level: String,
}

/// Main entry point for the solver service.
///
/// This function:
/// 1. Parses command-line arguments
/// 2. Initializes logging infrastructure
/// 3. Loads configuration from file
/// 4. Builds the solver engine with all implementations
/// 5. Runs the solver until interrupted
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	let args = Args::parse();

	// Initialize tracing with env filter
	use tracing_subscriber::{fmt, EnvFilter};

	// Create env filter with default from args
	let default_directive = args.log_level.to_string();
	let env_filter =
		EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_directive));

	fmt()
		.with_env_filter(env_filter)
		.with_thread_ids(true)
		.with_target(true)
		.init();

	tracing::info!("Started solver");

	// Load configuration
	let config = Config::from_file_async(args.config.to_str().unwrap()).await?;
	tracing::info!("Loaded configuration [{}]", config.solver.id);

	// Build solver engine with implementations
	let solver = build_solver(config.clone()).await?;
	let solver = Arc::new(solver);

	// Check if API server should be started
	let api_enabled = config.api.as_ref().is_some_and(|api| api.enabled);

	if api_enabled {
		let api_config = config.api.as_ref().unwrap().clone();
		let api_solver = Arc::clone(&solver);

		// Start both the solver and the API server concurrently
		let solver_task = solver.run();
		let api_task = server::start_server(api_config, api_solver);

		// Run both tasks concurrently
		tokio::select! {
			result = solver_task => {
				tracing::info!("Solver finished");
				result?;
			}
			result = api_task => {
				tracing::info!("API server finished");
				result?;
			}
		}
	} else {
		// Run only the solver
		tracing::info!("Starting solver only");
		solver.run().await?;
	}

	tracing::info!("Stopped solver");
	Ok(())
}

/// Macro to create a factory HashMap with the appropriate type aliases
macro_rules! create_factory_map {
    ($interface:path, $error:path, $( $name:literal => $factory:expr ),* $(,)?) => {{
        let mut factories = std::collections::HashMap::new();
        $(
            factories.insert(
                $name.to_string(),
                $factory as fn(&toml::Value) -> Result<Box<dyn $interface>, $error>
            );
        )*
        factories
    }};

    // Variant for factories that take networks config
    ($interface:path, $error:path, networks, $( $name:literal => $factory:expr ),* $(,)?) => {{
        let mut factories = std::collections::HashMap::new();
        $(
            factories.insert(
                $name.to_string(),
                $factory as fn(&toml::Value, &solver_types::NetworksConfig) -> Result<Box<dyn $interface>, $error>
            );
        )*
        factories
    }};

    // Variant for delivery factories that take networks and optional private key
    ($interface:path, $error:path, delivery, $( $name:literal => $factory:expr ),* $(,)?) => {{
        let mut factories = std::collections::HashMap::new();
        $(
            factories.insert(
                $name.to_string(),
                $factory as fn(&toml::Value, &solver_types::NetworksConfig, Option<&solver_types::SecretString>) -> Result<Box<dyn $interface>, $error>
            );
        )*
        factories
    }};
}

/// Builds the solver engine with all necessary implementations.
///
/// This function wires up all the concrete implementations for:
/// - Storage backends (e.g., in-memory, Redis)
/// - Account providers (e.g., local keys, AWS KMS)
/// - Delivery mechanisms (e.g., HTTP RPC, WebSocket)
/// - Discovery sources (e.g., on-chain events, off-chain APIs)
/// - Order implementations (e.g., EIP-7683)
/// - Settlement mechanisms (e.g., direct settlement)
/// - Execution strategies (e.g., always execute, limit orders)
async fn build_solver(config: Config) -> Result<SolverEngine, Box<dyn std::error::Error>> {
	let builder = SolverBuilder::new(config);

	// Storage factories (simple config-only interface)
	let storage_factories = create_factory_map!(
		solver_storage::StorageInterface,
		solver_storage::StorageError,
		"file" => create_file_storage,
		"memory" => create_memory_storage,
	);

	// Delivery factories (config + networks + optional private key)
	let delivery_factories = create_factory_map!(
		solver_delivery::DeliveryInterface,
		solver_delivery::DeliveryError,
		delivery,
		"origin" => create_http_delivery,
		"destination" => create_http_delivery,
	);

	// Discovery factories (config + networks)
	let discovery_factories = create_factory_map!(
		solver_discovery::DiscoveryInterface,
		solver_discovery::DiscoveryError,
		networks,
		"onchain_eip7683" => onchain_create_discovery,
		"offchain_eip7683" => offchain_create_discovery,
	);

	// Order factories (config + networks)
	let order_factories = create_factory_map!(
		solver_order::OrderInterface,
		solver_order::OrderError,
		networks,
		"eip7683" => create_order_impl,
	);

	// Settlement factories (config + networks)
	let settlement_factories = create_factory_map!(
		solver_settlement::SettlementInterface,
		solver_settlement::SettlementError,
		networks,
		"eip7683" => create_settlement,
	);

	let factories = SolverFactories {
		storage_factories,
		account_factory: create_account,
		delivery_factories,
		discovery_factories,
		order_factories,
		settlement_factories,
		strategy_factory: create_strategy,
	};

	Ok(builder.build(factories).await?)
}

#[cfg(test)]
mod tests {
	use super::*;
	use solver_config::{
		AccountConfig, DeliveryConfig, DiscoveryConfig, OrderConfig, SettlementConfig,
		SolverConfig, StorageConfig, StrategyConfig,
	};
	use solver_types::NetworksConfig;
	use std::collections::HashMap;
	use tempfile::tempdir;
	use toml::Value;

	/// Creates a minimal test configuration for unit testing
	fn create_test_config() -> Config {
		Config {
			solver: SolverConfig {
				id: "test-solver".to_string(),
				monitoring_timeout_minutes: 1,
			},
			networks: NetworksConfig::new(),
			storage: StorageConfig {
				primary: "memory".to_string(),
				cleanup_interval_seconds: 60,
				implementations: {
					let mut map = HashMap::new();
					map.insert("memory".to_string(), Value::Table(toml::map::Map::new()));
					map
				},
			},
			account: AccountConfig {
				provider: "local".to_string(),
				config: {
					let mut map = toml::map::Map::new();
					map.insert(
						"private_key".to_string(),
						Value::String(
							"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
								.to_string(),
						),
					);
					Value::Table(map)
				},
			},
			delivery: DeliveryConfig {
				providers: HashMap::new(),
				min_confirmations: 1,
			},
			discovery: DiscoveryConfig {
				sources: HashMap::new(),
			},
			order: OrderConfig {
				implementations: HashMap::new(),
				execution_strategy: StrategyConfig {
					strategy_type: "simple".to_string(),
					config: Value::Table(toml::map::Map::new()),
				},
			},
			settlement: SettlementConfig {
				implementations: HashMap::new(),
				domain: None,
			},
			api: None,
		}
	}

	#[test]
	fn test_args_default_values() {
		let args = Args {
			config: PathBuf::from("config.toml"),
			log_level: "info".to_string(),
		};

		assert_eq!(args.config, PathBuf::from("config.toml"));
		assert_eq!(args.log_level, "info");
	}

	#[test]
	fn test_args_custom_values() {
		let args = Args {
			config: PathBuf::from("custom.toml"),
			log_level: "debug".to_string(),
		};

		assert_eq!(args.config, PathBuf::from("custom.toml"));
		assert_eq!(args.log_level, "debug");
	}

	#[test]
	fn test_create_factory_map_macro() {
		use solver_storage::implementations::memory::create_storage;
		use solver_storage::{StorageError, StorageInterface};

		let factories = create_factory_map!(
			StorageInterface,
			StorageError,
			"memory" => create_storage,
		);

		assert_eq!(factories.len(), 1);
		assert!(factories.contains_key("memory"));
	}

	#[test]
	fn test_create_factory_map_multiple_entries() {
		use solver_storage::implementations::{
			file::create_storage as create_file, memory::create_storage as create_memory,
		};
		use solver_storage::{StorageError, StorageInterface};

		let factories = create_factory_map!(
			StorageInterface,
			StorageError,
			"memory" => create_memory,
			"file" => create_file,
		);

		assert_eq!(factories.len(), 2);
		assert!(factories.contains_key("memory"));
		assert!(factories.contains_key("file"));
	}

	#[tokio::test]
	async fn test_build_solver_with_minimal_config() {
		let config = create_test_config();

		let result = build_solver(config).await;

		// Should succeed with minimal valid configuration
		assert!(result.is_ok(), "Failed to build solver: {:?}", result.err());

		let solver = result.unwrap();
		assert_eq!(solver.config().solver.id, "test-solver");
	}

	#[tokio::test]
	async fn test_build_solver_creates_all_factories() {
		let config = create_test_config();

		let solver = build_solver(config).await.expect("Failed to build solver");

		// Verify the solver was created successfully
		// Since SolverEngine doesn't expose factories directly, we test by ensuring
		// the build process completes without errors
		assert!(solver.config().solver.id == "test-solver");
	}

	#[test]
	fn test_delivery_factories_creation() {
		let delivery_factories = create_factory_map!(
			solver_delivery::DeliveryInterface,
			solver_delivery::DeliveryError,
			delivery,
			"origin" => create_http_delivery,
			"destination" => create_http_delivery,
		);

		assert_eq!(delivery_factories.len(), 2);
		assert!(delivery_factories.contains_key("origin"));
		assert!(delivery_factories.contains_key("destination"));
	}

	#[test]
	fn test_storage_factories_creation() {
		let storage_factories = create_factory_map!(
			solver_storage::StorageInterface,
			solver_storage::StorageError,
			"file" => create_file_storage,
			"memory" => create_memory_storage,
		);

		assert_eq!(storage_factories.len(), 2);
		assert!(storage_factories.contains_key("file"));
		assert!(storage_factories.contains_key("memory"));
	}

	#[test]
	fn test_settlement_factories_creation() {
		let settlement_factories = create_factory_map!(
			solver_settlement::SettlementInterface,
			solver_settlement::SettlementError,
			networks,
			"eip7683" => create_settlement,
		);

		assert_eq!(settlement_factories.len(), 1);
		assert!(settlement_factories.contains_key("eip7683"));
	}

	#[test]
	fn test_discovery_factories_manual_creation() {
		let mut discovery_factories = std::collections::HashMap::new();

		discovery_factories.insert(
			"onchain_eip7683".to_string(),
			onchain_create_discovery
				as fn(
					&toml::Value,
					&solver_types::NetworksConfig,
				) -> Result<
					Box<dyn solver_discovery::DiscoveryInterface>,
					solver_discovery::DiscoveryError,
				>,
		);

		discovery_factories.insert(
			"offchain_eip7683".to_string(),
			offchain_create_discovery
				as fn(
					&toml::Value,
					&solver_types::NetworksConfig,
				) -> Result<
					Box<dyn solver_discovery::DiscoveryInterface>,
					solver_discovery::DiscoveryError,
				>,
		);

		assert_eq!(discovery_factories.len(), 2);
		assert!(discovery_factories.contains_key("onchain_eip7683"));
		assert!(discovery_factories.contains_key("offchain_eip7683"));
	}

	#[test]
	fn test_order_factories_manual_creation() {
		let mut order_factories = std::collections::HashMap::new();

		order_factories.insert(
			"eip7683".to_string(),
			create_order_impl
				as fn(
					&toml::Value,
					&solver_types::NetworksConfig,
				)
					-> Result<Box<dyn solver_order::OrderInterface>, solver_order::OrderError>,
		);

		assert_eq!(order_factories.len(), 1);
		assert!(order_factories.contains_key("eip7683"));
	}

	#[tokio::test]
	async fn test_build_solver_with_file_config() {
		let temp_dir = tempdir().expect("Failed to create temp dir");
		let config_path = temp_dir.path().join("test_config.toml");

		// Create a test config file that won't try to connect to networks
		let config_content = r#"
[solver]
id = "test-file-solver"
monitoring_timeout_minutes = 2

[networks.31337]
rpc_url = "http://localhost:8545"
input_settler_address = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
output_settler_address = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
[[networks.31337.tokens]]
address = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
symbol = "TOKA"
decimals = 18

[networks.31338]
rpc_url = "http://localhost:8546"
input_settler_address = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
output_settler_address = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
[[networks.31338.tokens]]
address = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
symbol = "TOKA"
decimals = 18

[storage]
primary = "memory"
cleanup_interval_seconds = 120

[storage.implementations.memory]

[account]
provider = "local"
[account.config]
private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

[delivery]
min_confirmations = 1
[delivery.providers.test]

[discovery]
[discovery.sources.test]

[order]
[order.implementations.test]
[order.execution_strategy]
strategy_type = "simple"
[order.execution_strategy.config]

[settlement]
[settlement.implementations.test]
"#;

		std::fs::write(&config_path, config_content).expect("Failed to write config");

		let config =
			Config::from_file(config_path.to_str().unwrap()).expect("Failed to load config");

		// Test only config loading, not actual solver building since that requires network connections
		assert_eq!(config.solver.id, "test-file-solver");
		assert_eq!(config.solver.monitoring_timeout_minutes, 2);
		assert!(!config.networks.is_empty());
		assert!(!config.delivery.providers.is_empty());
	}

	// Test for ensuring SolverFactories struct is properly constructed
	#[test]
	fn test_solver_factories_construction() {
		let storage_factories = create_factory_map!(
			solver_storage::StorageInterface,
			solver_storage::StorageError,
			"memory" => create_memory_storage,
		);

		let delivery_factories = create_factory_map!(
			solver_delivery::DeliveryInterface,
			solver_delivery::DeliveryError,
			delivery,
			"origin" => create_http_delivery,
		);

		let settlement_factories = create_factory_map!(
			solver_settlement::SettlementInterface,
			solver_settlement::SettlementError,
			networks,
			"eip7683" => create_settlement,
		);

		let mut discovery_factories = std::collections::HashMap::new();
		discovery_factories.insert(
			"onchain_eip7683".to_string(),
			onchain_create_discovery
				as fn(
					&toml::Value,
					&solver_types::NetworksConfig,
				) -> Result<
					Box<dyn solver_discovery::DiscoveryInterface>,
					solver_discovery::DiscoveryError,
				>,
		);

		let mut order_factories = std::collections::HashMap::new();
		order_factories.insert(
			"eip7683".to_string(),
			create_order_impl
				as fn(
					&toml::Value,
					&solver_types::NetworksConfig,
				)
					-> Result<Box<dyn solver_order::OrderInterface>, solver_order::OrderError>,
		);

		let factories = SolverFactories {
			storage_factories,
			account_factory: create_account,
			delivery_factories,
			discovery_factories,
			order_factories,
			settlement_factories,
			strategy_factory: create_strategy,
		};

		// Verify all factories are properly set
		assert!(!factories.storage_factories.is_empty());
		assert!(!factories.delivery_factories.is_empty());
		assert!(!factories.discovery_factories.is_empty());
		assert!(!factories.order_factories.is_empty());
		assert!(!factories.settlement_factories.is_empty());
	}
}
