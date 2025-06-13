// chains.ts - Multi-chain network configuration for OIF Protocol Solver
// Includes RPC endpoints, chain IDs, gas strategies, and network-specific settings

export interface GasConfig {
  // Base gas settings
  defaultGasLimit: bigint;
  maxGasLimit: bigint;
  gasLimitMultiplier: number;

  // Gas price settings
  defaultGasPrice: bigint;
  maxGasPrice: bigint;
  priorityFee: bigint;
  
  // EIP-1559 settings
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  
  // Gas estimation
  gasEstimationMultiplier: number;
  gasEstimationBuffer: number;
}

export interface ChainConfig {
  // Basic chain information
  chainId: number;
  name: string;
  shortName: string;
  networkType: 'mainnet' | 'testnet' | 'local';
  
  // RPC configuration
  rpcUrls: string[];
  fallbackRpcUrls?: string[];
  rpcTimeout: number;
  maxRetries: number;
  
  // Block configuration
  blockTime: number; // Average block time in seconds
  confirmationBlocks: number;
  maxReorgDepth: number;
  
  // Gas configuration
  gasConfig: GasConfig;
  
  // Network features
  supportsEIP1559: boolean;
  supportsEIP2930: boolean;
  
  // Explorer and metadata
  blockExplorer?: {
    name: string;
    url: string;
    apiUrl?: string;
  };
  
  // Native token
  nativeToken: {
    name: string;
    symbol: string;
    decimals: number;
  };
  
  // OIF Protocol specific settings
  oifSettings?: {
    // Settlement timing
    minSettlementDelay: number;
    maxSettlementDelay: number;
    
    // Oracle settings
    oracleUpdateFrequency: number;
    maxOracleStaleness: number;
    
    // Risk parameters
    maxOrderValue: bigint;
    minOrderValue: bigint;
  };
}

export interface ChainPair {
  originChain: number;
  destinationChain: number;
  enabled: boolean;
  
  // Cross-chain specific settings
  bridgeDelay: number; // Expected time for cross-chain operations
  maxSlippage: number; // Maximum acceptable slippage in basis points
  
  // Risk management
  maxDailyVolume: bigint;
  maxSingleOrderValue: bigint;
  
  // Monitoring
  alertThresholds: {
    highLatency: number;
    highFailureRate: number;
    lowLiquidity: bigint;
  };
}

/**
 * Multi-Chain Configuration for OIF Protocol Solver
 */
export class ChainConfiguration {
  private chains: Map<number, ChainConfig> = new Map();
  private chainPairs: Map<string, ChainPair> = new Map();
  
  constructor() {
    this.initializeDefaultChains();
    this.initializeChainPairs();
  }

  /**
   * Initialize default chain configurations
   */
  private initializeDefaultChains(): void {
    // Local test chains (matching automation scripts)
    this.addChain({
      chainId: 31337,
      name: 'Hardhat Local Origin',
      shortName: 'local-origin',
      networkType: 'local',
      rpcUrls: ['http://127.0.0.1:8545'],
      rpcTimeout: 30000,
      maxRetries: 3,
      blockTime: 2,
      confirmationBlocks: 1,
      maxReorgDepth: 10,
      gasConfig: {
        defaultGasLimit: BigInt(500000),
        maxGasLimit: BigInt(30000000),
        gasLimitMultiplier: 1.2,
        defaultGasPrice: BigInt('20000000000'), // 20 gwei
        maxGasPrice: BigInt('100000000000'), // 100 gwei
        priorityFee: BigInt('1000000000'), // 1 gwei
        gasEstimationMultiplier: 1.1,
        gasEstimationBuffer: 21000
      },
      supportsEIP1559: false,
      supportsEIP2930: false,
      nativeToken: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18
      },
      oifSettings: {
        minSettlementDelay: 10, // 10 seconds for local testing
        maxSettlementDelay: 300, // 5 minutes
        oracleUpdateFrequency: 30,
        maxOracleStaleness: 300,
        maxOrderValue: BigInt('100000000000000000000'), // 100 ETH
        minOrderValue: BigInt('1000000000000000') // 0.001 ETH
      }
    });

    this.addChain({
      chainId: 31338,
      name: 'Hardhat Local Destination',
      shortName: 'local-destination',
      networkType: 'local',
      rpcUrls: ['http://127.0.0.1:8546'],
      rpcTimeout: 30000,
      maxRetries: 3,
      blockTime: 2,
      confirmationBlocks: 1,
      maxReorgDepth: 10,
      gasConfig: {
        defaultGasLimit: BigInt(500000),
        maxGasLimit: BigInt(30000000),
        gasLimitMultiplier: 1.2,
        defaultGasPrice: BigInt('20000000000'), // 20 gwei
        maxGasPrice: BigInt('100000000000'), // 100 gwei
        priorityFee: BigInt('1000000000'), // 1 gwei
        gasEstimationMultiplier: 1.1,
        gasEstimationBuffer: 21000
      },
      supportsEIP1559: false,
      supportsEIP2930: false,
      nativeToken: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18
      },
      oifSettings: {
        minSettlementDelay: 10,
        maxSettlementDelay: 300,
        oracleUpdateFrequency: 30,
        maxOracleStaleness: 300,
        maxOrderValue: BigInt('100000000000000000000'), // 100 ETH
        minOrderValue: BigInt('1000000000000000') // 0.001 ETH
      }
    });

    // Ethereum Sepolia Testnet
    this.addChain({
      chainId: 11155111,
      name: 'Ethereum Sepolia',
      shortName: 'sepolia',
      networkType: 'testnet',
      rpcUrls: [
        'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
        'https://rpc.sepolia.org'
      ],
      fallbackRpcUrls: [
        'https://rpc2.sepolia.org',
        'https://rpc.sepolia.dev'
      ],
      rpcTimeout: 30000,
      maxRetries: 3,
      blockTime: 12,
      confirmationBlocks: 2,
      maxReorgDepth: 10,
      gasConfig: {
        defaultGasLimit: BigInt(500000),
        maxGasLimit: BigInt(30000000),
        gasLimitMultiplier: 1.2,
        defaultGasPrice: BigInt('20000000000'), // 20 gwei
        maxGasPrice: BigInt('100000000000'), // 100 gwei
        priorityFee: BigInt('2000000000'), // 2 gwei
        maxFeePerGas: BigInt('50000000000'), // 50 gwei
        maxPriorityFeePerGas: BigInt('2000000000'), // 2 gwei
        gasEstimationMultiplier: 1.2,
        gasEstimationBuffer: 21000
      },
      supportsEIP1559: true,
      supportsEIP2930: true,
      blockExplorer: {
        name: 'Sepolia Etherscan',
        url: 'https://sepolia.etherscan.io',
        apiUrl: 'https://api-sepolia.etherscan.io/api'
      },
      nativeToken: {
        name: 'Sepolia Ether',
        symbol: 'SEP',
        decimals: 18
      },
      oifSettings: {
        minSettlementDelay: 60, // 1 minute for testing
        maxSettlementDelay: 1800, // 30 minutes
        oracleUpdateFrequency: 120, // 2 minutes
        maxOracleStaleness: 600, // 10 minutes
        maxOrderValue: BigInt('10000000000000000000'), // 10 ETH
        minOrderValue: BigInt('1000000000000000') // 0.001 ETH
      }
    });

    // Polygon Mumbai Testnet
    this.addChain({
      chainId: 80001,
      name: 'Polygon Mumbai',
      shortName: 'mumbai',
      networkType: 'testnet',
      rpcUrls: [
        'https://rpc-mumbai.maticvigil.com',
        'https://polygon-mumbai.g.alchemy.com/v2/demo'
      ],
      fallbackRpcUrls: [
        'https://rpc.ankr.com/polygon_mumbai',
        'https://polygon-testnet.public.blastapi.io'
      ],
      rpcTimeout: 30000,
      maxRetries: 3,
      blockTime: 2,
      confirmationBlocks: 3,
      maxReorgDepth: 10,
      gasConfig: {
        defaultGasLimit: BigInt(500000),
        maxGasLimit: BigInt(20000000),
        gasLimitMultiplier: 1.2,
        defaultGasPrice: BigInt('30000000000'), // 30 gwei
        maxGasPrice: BigInt('200000000000'), // 200 gwei
        priorityFee: BigInt('30000000000'), // 30 gwei
        maxFeePerGas: BigInt('100000000000'), // 100 gwei
        maxPriorityFeePerGas: BigInt('30000000000'), // 30 gwei
        gasEstimationMultiplier: 1.3,
        gasEstimationBuffer: 21000
      },
      supportsEIP1559: true,
      supportsEIP2930: true,
      blockExplorer: {
        name: 'Mumbai PolygonScan',
        url: 'https://mumbai.polygonscan.com',
        apiUrl: 'https://api-testnet.polygonscan.com/api'
      },
      nativeToken: {
        name: 'Mumbai MATIC',
        symbol: 'MATIC',
        decimals: 18
      },
      oifSettings: {
        minSettlementDelay: 30, // 30 seconds for testing
        maxSettlementDelay: 600, // 10 minutes
        oracleUpdateFrequency: 60, // 1 minute
        maxOracleStaleness: 300, // 5 minutes
        maxOrderValue: BigInt('10000000000000000000000'), // 10k MATIC
        minOrderValue: BigInt('1000000000000000000') // 1 MATIC
      }
    });
  }

  /**
   * Initialize default chain pairs for cross-chain operations
   */
  private initializeChainPairs(): void {
    // Local test chains pair
    this.addChainPair({
      originChain: 31337,
      destinationChain: 31338,
      enabled: true,
      bridgeDelay: 30, // 30 seconds for local testing
      maxSlippage: 100, // 1%
      maxDailyVolume: BigInt('1000000000000000000000'), // 1000 ETH
      maxSingleOrderValue: BigInt('100000000000000000000'), // 100 ETH
      alertThresholds: {
        highLatency: 60, // 60 seconds
        highFailureRate: 0.1, // 10%
        lowLiquidity: BigInt('1000000000000000000') // 1 ETH
      }
    });

    // Testnet pairs
    this.addChainPair({
      originChain: 11155111,
      destinationChain: 80001,
      enabled: true,
      bridgeDelay: 300, // 5 minutes
      maxSlippage: 200, // 2%
      maxDailyVolume: BigInt('100000000000000000000'), // 100 ETH
      maxSingleOrderValue: BigInt('10000000000000000000'), // 10 ETH
      alertThresholds: {
        highLatency: 600, // 10 minutes
        highFailureRate: 0.2, // 20%
        lowLiquidity: BigInt('1000000000000000000') // 1 ETH
      }
    });

    this.addChainPair({
      originChain: 80001,
      destinationChain: 11155111,
      enabled: true,
      bridgeDelay: 300, // 5 minutes
      maxSlippage: 200, // 2%
      maxDailyVolume: BigInt('100000000000000000000000'), // 100k MATIC
      maxSingleOrderValue: BigInt('10000000000000000000000'), // 10k MATIC
      alertThresholds: {
        highLatency: 600, // 10 minutes
        highFailureRate: 0.2, // 20%
        lowLiquidity: BigInt('1000000000000000000000') // 1k MATIC
      }
    });
  }

  /**
   * Add a new chain configuration
   */
  addChain(config: ChainConfig): void {
    this.chains.set(config.chainId, config);
  }

  /**
   * Add a new chain pair configuration
   */
  addChainPair(pair: ChainPair): void {
    const key = `${pair.originChain}-${pair.destinationChain}`;
    this.chainPairs.set(key, pair);
  }

  /**
   * Get chain configuration by chain ID
   */
  getChain(chainId: number): ChainConfig | undefined {
    return this.chains.get(chainId);
  }

  /**
   * Get chain pair configuration
   */
  getChainPair(originChain: number, destinationChain: number): ChainPair | undefined {
    const key = `${originChain}-${destinationChain}`;
    return this.chainPairs.get(key);
  }

  /**
   * Get all supported chains
   */
  getAllChains(): ChainConfig[] {
    return Array.from(this.chains.values());
  }

  /**
   * Get all enabled chain pairs
   */
  getEnabledChainPairs(): ChainPair[] {
    return Array.from(this.chainPairs.values()).filter(pair => pair.enabled);
  }

  /**
   * Get chains by network type
   */
  getChainsByType(networkType: 'mainnet' | 'testnet' | 'local'): ChainConfig[] {
    return this.getAllChains().filter(chain => chain.networkType === networkType);
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chainId: number): boolean {
    return this.chains.has(chainId);
  }

  /**
   * Check if a chain pair is enabled
   */
  isChainPairEnabled(originChain: number, destinationChain: number): boolean {
    const pair = this.getChainPair(originChain, destinationChain);
    return pair?.enabled ?? false;
  }

  /**
   * Get gas configuration for a chain
   */
  getGasConfig(chainId: number): GasConfig | undefined {
    return this.getChain(chainId)?.gasConfig;
  }

  /**
   * Get OIF settings for a chain
   */
  getOifSettings(chainId: number) {
    return this.getChain(chainId)?.oifSettings;
  }

  /**
   * Get configuration summary
   */
  getSummary(): {
    totalChains: number;
    totalPairs: number;
    enabledPairs: number;
    mainnetChains: number;
    testnetChains: number;
    localChains: number;
  } {
    const chains = this.getAllChains();
    const pairs = Array.from(this.chainPairs.values());

    return {
      totalChains: chains.length,
      totalPairs: pairs.length,
      enabledPairs: pairs.filter(p => p.enabled).length,
      mainnetChains: chains.filter(c => c.networkType === 'mainnet').length,
      testnetChains: chains.filter(c => c.networkType === 'testnet').length,
      localChains: chains.filter(c => c.networkType === 'local').length
    };
  }
}

// Default global configuration instance
export const chainConfig = new ChainConfiguration();

// Export commonly used chain IDs
export const CHAIN_IDS = {
  // Local test chains
  LOCAL_ORIGIN: 31337,
  LOCAL_DESTINATION: 31338,
  
  // Testnets
  SEPOLIA: 11155111,
  MUMBAI: 80001
} as const;

// Export common chain configurations
export const COMMON_CHAINS = {
  LOCAL_ORIGIN: chainConfig.getChain(CHAIN_IDS.LOCAL_ORIGIN)!,
  LOCAL_DESTINATION: chainConfig.getChain(CHAIN_IDS.LOCAL_DESTINATION)!,
  SEPOLIA: chainConfig.getChain(CHAIN_IDS.SEPOLIA)!,
  MUMBAI: chainConfig.getChain(CHAIN_IDS.MUMBAI)!
};

export default chainConfig; 