// solver.ts - Solver-specific configuration for OIF Protocol Solver
// Includes profitability thresholds, risk parameters, and operational settings

export interface ProfitabilityThresholds {
  minProfitWei: bigint;
  minProfitMarginBps: number; // Basis points
  maxGasPrice: bigint;
  gasPriceBuffer: number;
  maxSlippageBps: number;
  maxOrderAge: number;
  minFillTime: number;
}

export interface RiskParameters {
  maxOrderValue: bigint;
  minOrderValue: bigint;
  maxDailyVolume: bigint;
  maxDailyOrders: number;
  maxConcurrentOrders: number;
  enableEmergencyStop: boolean;
}

export interface WalletConfig {
  alias: string;
  address: string;
  privateKey: string;
  type: 'hot' | 'cold';
  chains: number[];
  purposes: ('signing' | 'filling' | 'finalization')[];
  isDefault?: boolean;
}

export interface OperationalSettings {
  monitoringInterval: number;
  maxQueueSize: number;
  priorityStrategy: 'profit' | 'margin' | 'time' | 'hybrid' | 'fifo';
  defaultRetryAttempts: number;
  defaultRetryDelay: number;
  apiEnabled: boolean;
  apiPort: number;
}

export interface SolverConfig {
  solverId: string;
  solverName: string;
  version: string;
  supportedChains: number[];
  profitabilityThresholds: ProfitabilityThresholds;
  riskParameters: RiskParameters;
  wallets: WalletConfig[];
  defaultWallet: string;
  operational: OperationalSettings;
  environment: 'development' | 'staging' | 'production';
  debugMode: boolean;
}

/**
 * Solver Configuration Manager
 */
export class SolverConfiguration {
  private config: SolverConfig;
  
  constructor(config?: Partial<SolverConfig>) {
    this.config = this.initializeDefaultConfig();
    if (config) {
      this.updateConfig(config);
    }
  }

  private initializeDefaultConfig(): SolverConfig {
    return {
      solverId: 'oif-solver-001',
      solverName: 'OIF Protocol Solver MVP',
      version: '1.0.0',
      supportedChains: [31337, 31338, 11155111, 80001],
      
      profitabilityThresholds: {
        minProfitWei: BigInt('1000000000000000'), // 0.001 ETH
        minProfitMarginBps: 500, // 5%
        maxGasPrice: BigInt('100000000000'), // 100 gwei
        gasPriceBuffer: 20,
        maxSlippageBps: 100, // 1%
        maxOrderAge: 24 * 60 * 60,
        minFillTime: 300
      },
      
      riskParameters: {
        maxOrderValue: BigInt('100000000000000000000'), // 100 ETH
        minOrderValue: BigInt('1000000000000000'), // 0.001 ETH
        maxDailyVolume: BigInt('1000000000000000000000'), // 1000 ETH
        maxDailyOrders: 1000,
        maxConcurrentOrders: 50,
        enableEmergencyStop: true
      },
      
      wallets: [],
      defaultWallet: '',
      
      operational: {
        monitoringInterval: 5000,
        maxQueueSize: 100,
        priorityStrategy: 'hybrid',
        defaultRetryAttempts: 3,
        defaultRetryDelay: 30000,
        apiEnabled: true,
        apiPort: 3001
      },
      
      environment: 'development',
      debugMode: true
    };
  }

  getConfig(): SolverConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SolverConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  addWallet(wallet: WalletConfig): void {
    const existingIndex = this.config.wallets.findIndex(w => w.alias === wallet.alias);
    
    if (existingIndex >= 0) {
      this.config.wallets[existingIndex] = wallet;
    } else {
      this.config.wallets.push(wallet);
    }
    
    if (this.config.wallets.length === 1 || wallet.isDefault) {
      this.config.defaultWallet = wallet.alias;
    }
  }

  getWallet(alias: string): WalletConfig | undefined {
    return this.config.wallets.find(w => w.alias === alias);
  }

  getDefaultWallet(): WalletConfig | undefined {
    return this.getWallet(this.config.defaultWallet);
  }

  isChainSupported(chainId: number): boolean {
    return this.config.supportedChains.includes(chainId);
  }

  loadFromEnvironment(): void {
    if (process.env.SOLVER_ID) {
      this.config.solverId = process.env.SOLVER_ID;
    }
    
    if (process.env.API_PORT) {
      this.config.operational.apiPort = parseInt(process.env.API_PORT);
    }
    
    if (process.env.MIN_PROFIT_WEI) {
      this.config.profitabilityThresholds.minProfitWei = BigInt(process.env.MIN_PROFIT_WEI);
    }
    
    if (process.env.SOLVER_PRIVATE_KEY && process.env.SOLVER_ADDRESS) {
      this.addWallet({
        alias: 'env-solver',
        address: process.env.SOLVER_ADDRESS,
        privateKey: process.env.SOLVER_PRIVATE_KEY,
        type: 'hot',
        chains: this.config.supportedChains,
        purposes: ['signing', 'filling', 'finalization'],
        isDefault: true
      });
    }
  }

  getSummary(): {
    solverId: string;
    supportedChains: number;
    configuredWallets: number;
    environment: string;
    apiEnabled: boolean;
    minProfitETH: string;
  } {
    return {
      solverId: this.config.solverId,
      supportedChains: this.config.supportedChains.length,
      configuredWallets: this.config.wallets.length,
      environment: this.config.environment,
      apiEnabled: this.config.operational.apiEnabled,
      minProfitETH: (Number(this.config.profitabilityThresholds.minProfitWei) / 1e18).toFixed(6)
    };
  }
}

export const solverConfig = new SolverConfiguration();
solverConfig.loadFromEnvironment();

export default solverConfig; 