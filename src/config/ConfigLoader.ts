import * as fs from 'fs';
import * as path from 'path';
import { ContractFactory } from '../contracts/ContractFactory';

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  isLocal?: boolean;
  contracts: {
    [contractName: string]: string;
  };
}

export interface WalletConfig {
  description?: string;
  address: string;
  privateKey: string;
}

export interface SolverConfig {
  wallet?: WalletConfig;
  api?: {
    port?: number;
    host?: string;
  };
  gas?: {
    maxGasPrice?: string;
    gasMultiplier?: number;
  };
  validation?: {
    enableSignatureValidation?: boolean;
    enableExpiryValidation?: boolean;
    minFillDeadline?: number;
  };
}

export interface ChainsConfig {
  description?: string;
  environment?: string;
  chains: {
    origin: ChainConfig;
    destination: ChainConfig;
  };
  solver?: SolverConfig;
  testing?: any;
}

export class ConfigLoader {
  /**
   * Load configuration from a JSON file
   */
  static loadFromFile(configPath: string): ChainsConfig {
    try {
      const fullPath = path.resolve(configPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Configuration file not found: ${fullPath}`);
      }

      const configData = fs.readFileSync(fullPath, 'utf8');
      const config = JSON.parse(configData) as ChainsConfig;

      // Validate required fields
      this.validateConfig(config);
      
      console.log(`✅ Loaded configuration from: ${fullPath}`);
      console.log(`📝 Environment: ${config.environment || 'unknown'}`);
      console.log(`🔗 Origin Chain: ${config.chains.origin.name} (${config.chains.origin.chainId})`);
      console.log(`🔗 Destination Chain: ${config.chains.destination.name} (${config.chains.destination.chainId})`);
      
      // Display wallet info if configured
      if (config.solver?.wallet) {
        console.log(`🔑 Solver Wallet: ${config.solver.wallet.address}`);
        if (config.solver.wallet.description) {
          console.log(`   📝 ${config.solver.wallet.description}`);
        }
      } else {
        console.log(`🔑 Solver Wallet: Using environment variable SOLVER_PRIVATE_KEY`);
      }

      return config;
    } catch (error) {
      console.error('❌ Error loading configuration:', error);
      throw error;
    }
  }

  /**
   * Convert chains config to solver config format
   */
  static toSolverConfig(chainsConfig: ChainsConfig): any {
    const solverConfig = chainsConfig.solver || {};
    
    // Set environment variable for wallet if configured
    if (solverConfig.wallet?.privateKey) {
      process.env.SOLVER_PRIVATE_KEY = solverConfig.wallet.privateKey;
      process.env.SOLVER_ADDRESS = solverConfig.wallet.address;
    }
    
    return {
      // API configuration
      api: {
        port: solverConfig.api?.port || 3000,
        host: solverConfig.api?.host || 'localhost',
        ...solverConfig.api
      },
      
      // Cross-chain configuration  
      crossChain: {
        gasMultiplier: solverConfig.gas?.gasMultiplier || 1.2,
        maxGasPrice: solverConfig.gas?.maxGasPrice ? 
          BigInt(solverConfig.gas.maxGasPrice) : 
          BigInt('100000000000'),
        retryAttempts: 3,
        
        // Chain-specific config
        originChain: {
          chainId: chainsConfig.chains.origin.chainId,
          rpcUrl: chainsConfig.chains.origin.rpcUrl,
          contracts: chainsConfig.chains.origin.contracts
        },
        destinationChain: {
          chainId: chainsConfig.chains.destination.chainId,
          rpcUrl: chainsConfig.chains.destination.rpcUrl,
          contracts: chainsConfig.chains.destination.contracts
        }
      },
      
      // Finalization configuration
      finalization: {
        gasMultiplier: (solverConfig.gas?.gasMultiplier || 1.2) + 0.1,
        maxGasPrice: solverConfig.gas?.maxGasPrice ? 
          BigInt(solverConfig.gas.maxGasPrice) : 
          BigInt('150000000000'),
        retryAttempts: 3
      },
      
      // Order validation configuration
      orderValidation: {
        enableSignatureValidation: solverConfig.validation?.enableSignatureValidation ?? false,
        enableExpiryValidation: solverConfig.validation?.enableExpiryValidation ?? true,
        minFillDeadline: solverConfig.validation?.minFillDeadline || 30,
        ...solverConfig.validation
      },
      
      // Wallet configuration
      wallet: solverConfig.wallet,
      
      // Include original config for reference
      _chainsConfig: chainsConfig
    };
  }

  /**
   * Configure ContractFactory with chains and contracts from configuration
   */
  static configureContractFactory(contractFactory: ContractFactory, chainsConfig: ChainsConfig): void {
    console.log('🏗️  Configuring ContractFactory with chains and contracts...');
    
    // Add origin chain
    contractFactory.addChain({
      chainId: chainsConfig.chains.origin.chainId,
      rpcUrl: chainsConfig.chains.origin.rpcUrl,
      name: chainsConfig.chains.origin.name
    });
    
    // Add destination chain
    contractFactory.addChain({
      chainId: chainsConfig.chains.destination.chainId,
      rpcUrl: chainsConfig.chains.destination.rpcUrl,
      name: chainsConfig.chains.destination.name
    });
    
    // Add origin chain contracts
    for (const [contractName, address] of Object.entries(chainsConfig.chains.origin.contracts)) {
      contractFactory.addContract(contractName, {
        address,
        abi: this.getContractABI(contractName) // We'll need to implement this
      });
      console.log(`   ✅ Added ${contractName} contract: ${address}`);
    }
    
    // Add destination chain contracts  
    for (const [contractName, address] of Object.entries(chainsConfig.chains.destination.contracts)) {
      contractFactory.addContract(contractName, {
        address,
        abi: this.getContractABI(contractName)
      });
      console.log(`   ✅ Added ${contractName} contract: ${address}`);
    }
    
    console.log(`✅ ContractFactory configured with ${contractFactory.getChainIds().length} chains and ${contractFactory.getContractNames().length} contracts`);
  }

  /**
   * Load and convert config in one step
   */
  static loadSolverConfig(configPath: string): any {
    const chainsConfig = this.loadFromFile(configPath);
    return this.toSolverConfig(chainsConfig);
  }

  /**
   * Load configuration and configure ContractFactory
   */
  static loadAndConfigureFactory(configPath: string, contractFactory: ContractFactory): any {
    const chainsConfig = this.loadFromFile(configPath);
    this.configureContractFactory(contractFactory, chainsConfig);
    return this.toSolverConfig(chainsConfig);
  }

  /**
   * Get default config file path
   */
  static getDefaultConfigPath(): string {
    return path.join(__dirname, '..', '..', 'config', 'chains-local.json');
  }

  /**
   * Get contract ABI for known contracts
   * TODO: Load from actual ABI files
   */
  private static getContractABI(contractName: string): any[] {
    // For now, return minimal ABI - should load from actual contract artifacts
    const minimalABIs: { [key: string]: any[] } = {
      'SettlerCompact': [
        'function finalise((address user,uint256 nonce,uint256 originChainId,uint32 expires,uint32 fillDeadline,address localOracle,uint256[2][] inputs,(bytes32 remoteOracle,bytes32 remoteFiller,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes remoteCall,bytes fulfillmentContext)[] outputs) order, bytes signatures, uint32[] timestamps, bytes32[] solvers, bytes32 destination, bytes call) external',
        'event Finalised(bytes32 indexed orderId, bytes32 indexed solver, bytes32 destination)'
      ],
      'TheCompact': [
        'function deposit(address token, uint256 amount) external',
        'function withdraw(address token, uint256 amount) external',
        'function __registerAllocator(address allocator, bytes calldata proof) external returns (uint96 allocatorId)',
        'event Deposit(address indexed user, address indexed token, uint256 amount)',
        'event AllocatorRegistered(uint96 indexed allocatorId, address indexed allocator)'
      ],
      'CoinFiller': [
        'function fill(uint32 fillDeadline, bytes32 orderId, tuple(bytes32 remoteOracle, bytes32 remoteFiller, uint256 chainId, bytes32 token, uint256 amount, bytes32 recipient, bytes remoteCall, bytes fulfillmentContext) output, bytes32 proposedSolver) external returns (bytes32)',
        'event OutputFilled(bytes32 indexed orderId, bytes32 solver, uint32 timestamp, tuple(bytes32 remoteOracle, bytes32 remoteFiller, uint256 chainId, bytes32 token, uint256 amount, bytes32 recipient, bytes remoteCall, bytes fulfillmentContext) output)'
      ]
    };
    
    return minimalABIs[contractName] || [];
  }

  /**
   * Validate configuration structure
   */
  private static validateConfig(config: ChainsConfig): void {
    if (!config.chains) {
      throw new Error('Configuration must have "chains" property');
    }
    
    if (!config.chains.origin) {
      throw new Error('Configuration must have "chains.origin" property');
    }
    
    if (!config.chains.destination) {
      throw new Error('Configuration must have "chains.destination" property');
    }
    
    // Validate origin chain
    const origin = config.chains.origin;
    if (!origin.chainId || !origin.rpcUrl) {
      throw new Error('Origin chain must have chainId and rpcUrl');
    }
    
    // Validate destination chain
    const destination = config.chains.destination;
    if (!destination.chainId || !destination.rpcUrl) {
      throw new Error('Destination chain must have chainId and rpcUrl');
    }
    
    // Validate wallet if provided
    if (config.solver?.wallet) {
      const wallet = config.solver.wallet;
      if (!wallet.address || !wallet.privateKey) {
        throw new Error('Wallet configuration must have both address and privateKey');
      }
      
      // Basic validation of private key format
      if (!wallet.privateKey.startsWith('0x') || wallet.privateKey.length !== 66) {
        throw new Error('Private key must be a valid hex string starting with 0x and 64 characters long');
      }
    }
    
    console.log('✅ Configuration validation passed');
  }
} 