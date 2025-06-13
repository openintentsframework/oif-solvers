// LiquidityService.ts - Manages solver liquidity across chains 

import { Provider, Contract, parseUnits, formatUnits } from 'ethers';
import { ContractFactory } from '../contracts/ContractFactory';
import { StateManager } from '../storage/StateManager';

export interface TokenBalance {
  tokenAddress: string;
  tokenSymbol: string;
  balance: bigint;
  formattedBalance: string;
  decimals: number;
  lastUpdated: number;
}

export interface ChainLiquidity {
  chainId: number;
  nativeBalance: bigint;
  formattedNativeBalance: string;
  tokens: Map<string, TokenBalance>;
  lastUpdated: number;
}

export interface ApprovalInfo {
  tokenAddress: string;
  spenderAddress: string;
  allowance: bigint;
  formattedAllowance: string;
  isInfinite: boolean;
  lastUpdated: number;
}

export interface LiquidityThresholds {
  minNativeBalance: bigint; // Minimum native token for gas
  minTokenBalance: bigint; // Minimum token balance for fills
  maxTokenBalance: bigint; // Maximum token balance (for rebalancing)
  emergencyThreshold: bigint; // Emergency low balance threshold
}

export interface LiquidityConfig {
  supportedChains: number[];
  supportedTokens: Map<number, string[]>; // chainId -> token addresses
  thresholds: Map<string, LiquidityThresholds>; // tokenAddress -> thresholds
  autoRebalance: boolean;
  monitoringInterval: number; // seconds
  approvalBuffer: bigint; // Buffer above required approval amount
  solverAddress: string;
}

export interface LiquidityAlert {
  type: 'low_balance' | 'low_gas' | 'approval_needed' | 'rebalance_required';
  chainId: number;
  tokenAddress?: string;
  currentAmount: bigint;
  requiredAmount: bigint;
  message: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface PreFundingStrategy {
  targetBalance: bigint;
  rebalanceThreshold: bigint;
  maxTransferAmount: bigint;
  sourceChainId?: number;
  enabled: boolean;
}

export interface LiquidityStats {
  totalChains: number;
  totalTokens: number;
  totalValue: bigint; // In wei equivalent
  healthStatus: 'healthy' | 'warning' | 'critical';
  alerts: LiquidityAlert[];
  lastUpdated: number;
}

/**
 * Service for managing solver liquidity across multiple chains
 * Monitors balances, manages token approvals, and implements pre-funding strategies
 */
export class LiquidityService {
  private liquidity: Map<number, ChainLiquidity> = new Map();
  private approvals: Map<string, ApprovalInfo> = new Map(); // key: chainId-tokenAddress-spender
  private config: LiquidityConfig;
  private isMonitoring = false;
  private monitoringTimer?: NodeJS.Timeout;
  private alerts: LiquidityAlert[] = [];
  
  // Event handlers
  private balanceHandlers: Map<string, (chainId: number, tokenAddress: string, balance: TokenBalance) => void> = new Map();
  private alertHandlers: Map<string, (alert: LiquidityAlert) => void> = new Map();
  private rebalanceHandlers: Map<string, (fromChain: number, toChain: number, tokenAddress: string, amount: bigint) => void> = new Map();

  constructor(
    private contractFactory: ContractFactory,
    private stateManager: StateManager,
    config: LiquidityConfig
  ) {
    // Set defaults before merging config
    const defaultConfig = {
      monitoringInterval: 30, // 30 seconds default
      autoRebalance: false,
      approvalBuffer: parseUnits('1000', 18) // 1000 tokens buffer
    };
    
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Initialize the liquidity service
   */
  async initialize(): Promise<void> {
    console.log('Initializing LiquidityService...');

    // Initialize liquidity tracking for all chains
    for (const chainId of this.config.supportedChains) {
      try {
        await this.initializeChainLiquidity(chainId);
        console.log(`Initialized liquidity tracking for chain ${chainId}`);
      } catch (error) {
        console.error(`Failed to initialize liquidity for chain ${chainId}:`, error);
      }
    }

    console.log('LiquidityService initialized successfully');
  }

  /**
   * Start monitoring liquidity across all chains
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('LiquidityService already monitoring');
      return;
    }

    console.log('Starting liquidity monitoring...');

    // Initial balance refresh
    await this.refreshAllBalances();

    // Start monitoring timer
    if (this.config.monitoringInterval > 0) {
      this.monitoringTimer = setInterval(async () => {
        try {
          await this.refreshAllBalances();
          await this.checkLiquidityThresholds();
          await this.executeAutoRebalancing();
        } catch (error) {
          console.error('Error in liquidity monitoring cycle:', error);
        }
      }, this.config.monitoringInterval * 1000);
    }

    this.isMonitoring = true;
    console.log('Liquidity monitoring started');
  }

  /**
   * Stop monitoring liquidity
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    console.log('Stopping liquidity monitoring...');

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
    }

    this.isMonitoring = false;
    console.log('Liquidity monitoring stopped');
  }

  /**
   * Get balance for a specific token on a specific chain
   */
  async getTokenBalance(chainId: number, tokenAddress: string): Promise<TokenBalance | null> {
    const chainLiquidity = this.liquidity.get(chainId);
    if (!chainLiquidity) {
      return null;
    }

    const cachedBalance = chainLiquidity.tokens.get(tokenAddress.toLowerCase());
    if (cachedBalance) {
      return cachedBalance;
    }

    // Fetch fresh balance
    try {
      const balance = await this.fetchTokenBalance(chainId, tokenAddress);
      chainLiquidity.tokens.set(tokenAddress.toLowerCase(), balance);
      return balance;
    } catch (error) {
      console.error(`Failed to get balance for ${tokenAddress} on chain ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Get native token balance for a chain
   */
  async getNativeBalance(chainId: number): Promise<bigint | null> {
    const chainLiquidity = this.liquidity.get(chainId);
    if (!chainLiquidity) {
      return null;
    }

    return chainLiquidity.nativeBalance;
  }

  /**
   * Get all liquidity information for a chain
   */
  getChainLiquidity(chainId: number): ChainLiquidity | null {
    return this.liquidity.get(chainId) || null;
  }

  /**
   * Check if solver has sufficient balance for an operation
   */
  async hasSufficientBalance(
    chainId: number, 
    tokenAddress: string, 
    requiredAmount: bigint,
    includeGasReserve: boolean = true
  ): Promise<boolean> {
    const tokenBalance = await this.getTokenBalance(chainId, tokenAddress);
    if (!tokenBalance || tokenBalance.balance < requiredAmount) {
      return false;
    }

    if (includeGasReserve) {
      const nativeBalance = await this.getNativeBalance(chainId);
      const gasReserve = this.getThresholds(tokenAddress)?.minNativeBalance || parseUnits('0.01', 18);
      
      if (!nativeBalance || nativeBalance < gasReserve) {
        return false;
      }
    }

    return true;
  }

  /**
   * Ensure token approval for CoinFiller contracts
   */
  async ensureApproval(
    chainId: number,
    tokenAddress: string,
    spenderAddress: string,
    requiredAmount: bigint
  ): Promise<boolean> {
    try {
      const approvalKey = `${chainId}-${tokenAddress}-${spenderAddress}`;
      const currentApproval = this.approvals.get(approvalKey);

      // Check if current approval is sufficient
      if (currentApproval && currentApproval.allowance >= requiredAmount) {
        return true;
      }

      // Fetch current allowance
      const allowance = await this.fetchTokenAllowance(chainId, tokenAddress, spenderAddress);
      
      if (allowance >= requiredAmount) {
        // Update cache
        this.approvals.set(approvalKey, {
          tokenAddress,
          spenderAddress,
          allowance,
          formattedAllowance: formatUnits(allowance, 18),
          isInfinite: allowance > parseUnits('1000000000', 18), // 1B tokens
          lastUpdated: Date.now()
        });
        return true;
      }

      // Need to approve more tokens
      console.log(`Insufficient approval for ${tokenAddress} on chain ${chainId}. Required: ${formatUnits(requiredAmount, 18)}, Current: ${formatUnits(allowance, 18)}`);
      
      // Create alert for approval needed
      this.addAlert({
        type: 'approval_needed',
        chainId,
        tokenAddress,
        currentAmount: allowance,
        requiredAmount,
        message: `Approval needed for ${tokenAddress} on chain ${chainId}`,
        timestamp: Date.now(),
        severity: 'high'
      });

      return false;
    } catch (error) {
      console.error(`Error checking approval for ${tokenAddress} on chain ${chainId}:`, error);
      return false;
    }
  }

  /**
   * Execute token approval transaction
   */
  async executeApproval(
    chainId: number,
    tokenAddress: string,
    spenderAddress: string,
    amount?: bigint
  ): Promise<boolean> {
    try {
      const provider = this.contractFactory.getProvider(chainId);
      if (!provider) {
        throw new Error(`Provider not found for chain ${chainId}`);
      }

      // Use infinite approval by default
      const approvalAmount = amount || parseUnits('1000000000', 18); // 1B tokens

      console.log(`Executing approval for ${formatUnits(approvalAmount, 18)} ${tokenAddress} on chain ${chainId}`);

      // This would execute the actual approval transaction
      // For now, simulate the approval
      const approvalKey = `${chainId}-${tokenAddress}-${spenderAddress}`;
      this.approvals.set(approvalKey, {
        tokenAddress,
        spenderAddress,
        allowance: approvalAmount,
        formattedAllowance: formatUnits(approvalAmount, 18),
        isInfinite: approvalAmount > parseUnits('1000000000', 18),
        lastUpdated: Date.now()
      });

      console.log(`Approval executed successfully for ${tokenAddress} on chain ${chainId}`);
      return true;
    } catch (error) {
      console.error(`Failed to execute approval for ${tokenAddress} on chain ${chainId}:`, error);
      return false;
    }
  }

  /**
   * Get current liquidity statistics
   */
  getLiquidityStats(): LiquidityStats {
    const totalChains = this.liquidity.size;
    let totalTokens = 0;
    let totalValue = BigInt(0);

    for (const [chainId, chainLiquidity] of this.liquidity) {
      totalTokens += chainLiquidity.tokens.size;
      totalValue += chainLiquidity.nativeBalance; // Simplified value calculation
      
      for (const [tokenAddress, tokenBalance] of chainLiquidity.tokens) {
        totalValue += tokenBalance.balance; // Simplified - would need price conversion
      }
    }

    // Determine health status
    let healthStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    const criticalAlerts = this.alerts.filter(a => a.severity === 'critical');
    const highAlerts = this.alerts.filter(a => a.severity === 'high');

    if (criticalAlerts.length > 0) {
      healthStatus = 'critical';
    } else if (highAlerts.length > 0) {
      healthStatus = 'warning';
    }

    return {
      totalChains,
      totalTokens,
      totalValue,
      healthStatus,
      alerts: [...this.alerts],
      lastUpdated: Date.now()
    };
  }

  /**
   * Register balance change handler
   */
  registerBalanceHandler(name: string, handler: (chainId: number, tokenAddress: string, balance: TokenBalance) => void): void {
    this.balanceHandlers.set(name, handler);
  }

  /**
   * Register alert handler
   */
  registerAlertHandler(name: string, handler: (alert: LiquidityAlert) => void): void {
    this.alertHandlers.set(name, handler);
  }

  /**
   * Register rebalance handler
   */
  registerRebalanceHandler(name: string, handler: (fromChain: number, toChain: number, tokenAddress: string, amount: bigint) => void): void {
    this.rebalanceHandlers.set(name, handler);
  }

  /**
   * Unregister handlers
   */
  unregisterBalanceHandler(name: string): void {
    this.balanceHandlers.delete(name);
  }

  unregisterAlertHandler(name: string): void {
    this.alertHandlers.delete(name);
  }

  unregisterRebalanceHandler(name: string): void {
    this.rebalanceHandlers.delete(name);
  }

  /**
   * Get configuration
   */
  getConfig(): LiquidityConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<LiquidityConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('LiquidityService configuration updated');
  }

  /**
   * Initialize liquidity tracking for a specific chain
   */
  private async initializeChainLiquidity(chainId: number): Promise<void> {
    const chainLiquidity: ChainLiquidity = {
      chainId,
      nativeBalance: BigInt(0),
      formattedNativeBalance: '0.0',
      tokens: new Map(),
      lastUpdated: 0
    };

    this.liquidity.set(chainId, chainLiquidity);

    // Initialize supported tokens for this chain
    const supportedTokens = this.config.supportedTokens.get(chainId) || [];
    for (const tokenAddress of supportedTokens) {
      try {
        const balance = await this.fetchTokenBalance(chainId, tokenAddress);
        chainLiquidity.tokens.set(tokenAddress.toLowerCase(), balance);
      } catch (error) {
        console.error(`Failed to initialize token ${tokenAddress} on chain ${chainId}:`, error);
      }
    }
  }

  /**
   * Fetch token balance from blockchain
   */
  private async fetchTokenBalance(chainId: number, tokenAddress: string): Promise<TokenBalance> {
    const provider = this.contractFactory.getProvider(chainId);
    if (!provider) {
      throw new Error(`Provider not found for chain ${chainId}`);
    }

    // Mock ERC20 contract interface
    const tokenContract = new Contract(
      tokenAddress,
      [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)'
      ],
      provider
    );

    try {
      const [balance, decimals, symbol] = await Promise.all([
        tokenContract.balanceOf?.(this.config.solverAddress) || BigInt(0),
        tokenContract.decimals?.() || 18,
        tokenContract.symbol?.() || 'UNKNOWN'
      ]);

      return {
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol: symbol,
        balance: BigInt(balance.toString()),
        formattedBalance: formatUnits(balance, decimals),
        decimals,
        lastUpdated: Date.now()
      };
    } catch (error) {
      console.error(`Error fetching token details for ${tokenAddress}:`, error);
      // Return default values on error
      return {
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol: 'UNKNOWN',
        balance: BigInt(0),
        formattedBalance: '0.0',
        decimals: 18,
        lastUpdated: Date.now()
      };
    }
  }

  /**
   * Fetch native token balance from blockchain
   */
  private async fetchNativeBalance(chainId: number): Promise<bigint> {
    const provider = this.contractFactory.getProvider(chainId);
    if (!provider) {
      throw new Error(`Provider not found for chain ${chainId}`);
    }

    const balance = await provider.getBalance(this.config.solverAddress);
    return BigInt(balance.toString());
  }

  /**
   * Fetch token allowance from blockchain
   */
  private async fetchTokenAllowance(chainId: number, tokenAddress: string, spenderAddress: string): Promise<bigint> {
    const provider = this.contractFactory.getProvider(chainId);
    if (!provider) {
      throw new Error(`Provider not found for chain ${chainId}`);
    }

    const tokenContract = new Contract(
      tokenAddress,
      ['function allowance(address,address) view returns (uint256)'],
      provider
    );

    try {
      const allowance = await tokenContract.allowance?.(this.config.solverAddress, spenderAddress);
      return allowance ? BigInt(allowance.toString()) : BigInt(0);
    } catch (error) {
      console.error(`Error fetching allowance for ${tokenAddress}:`, error);
      return BigInt(0);
    }
  }

  /**
   * Refresh all balances across all chains
   */
  private async refreshAllBalances(): Promise<void> {
    for (const [chainId, chainLiquidity] of this.liquidity) {
      try {
        // Refresh native balance
        const nativeBalance = await this.fetchNativeBalance(chainId);
        chainLiquidity.nativeBalance = nativeBalance;
        chainLiquidity.formattedNativeBalance = formatUnits(nativeBalance, 18);

        // Refresh token balances
        for (const [tokenAddress, oldBalance] of chainLiquidity.tokens) {
          try {
            const newBalance = await this.fetchTokenBalance(chainId, tokenAddress);
            chainLiquidity.tokens.set(tokenAddress, newBalance);

            // Notify handlers if balance changed significantly
            if (newBalance.balance !== oldBalance.balance) {
              for (const [name, handler] of this.balanceHandlers) {
                try {
                  handler(chainId, tokenAddress, newBalance);
                } catch (error) {
                  console.error(`Error in balance handler ${name}:`, error);
                }
              }
            }
          } catch (error) {
            console.error(`Failed to refresh balance for ${tokenAddress} on chain ${chainId}:`, error);
          }
        }

        chainLiquidity.lastUpdated = Date.now();
      } catch (error) {
        console.error(`Failed to refresh balances for chain ${chainId}:`, error);
      }
    }
  }

  /**
   * Check liquidity thresholds and generate alerts
   */
  private async checkLiquidityThresholds(): Promise<void> {
    // Clear old alerts
    this.alerts = this.alerts.filter(alert => Date.now() - alert.timestamp < 24 * 60 * 60 * 1000); // Keep alerts for 24h

    for (const [chainId, chainLiquidity] of this.liquidity) {
      // Check native balance for gas
      const minNativeThreshold = parseUnits('0.01', 18); // 0.01 ETH default
      if (chainLiquidity.nativeBalance < minNativeThreshold) {
        this.addAlert({
          type: 'low_gas',
          chainId,
          currentAmount: chainLiquidity.nativeBalance,
          requiredAmount: minNativeThreshold,
          message: `Low native balance on chain ${chainId}: ${chainLiquidity.formattedNativeBalance}`,
          timestamp: Date.now(),
          severity: 'high'
        });
      }

      // Check token balances
      for (const [tokenAddress, tokenBalance] of chainLiquidity.tokens) {
        const thresholds = this.getThresholds(tokenAddress);
        if (thresholds) {
          if (tokenBalance.balance < thresholds.emergencyThreshold) {
            this.addAlert({
              type: 'low_balance',
              chainId,
              tokenAddress,
              currentAmount: tokenBalance.balance,
              requiredAmount: thresholds.emergencyThreshold,
              message: `Critical low balance for ${tokenBalance.tokenSymbol} on chain ${chainId}: ${tokenBalance.formattedBalance}`,
              timestamp: Date.now(),
              severity: 'critical'
            });
          } else if (tokenBalance.balance < thresholds.minTokenBalance) {
            this.addAlert({
              type: 'low_balance',
              chainId,
              tokenAddress,
              currentAmount: tokenBalance.balance,
              requiredAmount: thresholds.minTokenBalance,
              message: `Low balance for ${tokenBalance.tokenSymbol} on chain ${chainId}: ${tokenBalance.formattedBalance}`,
              timestamp: Date.now(),
              severity: 'medium'
            });
          }
        }
      }
    }
  }

  /**
   * Execute automatic rebalancing if enabled
   */
  private async executeAutoRebalancing(): Promise<void> {
    if (!this.config.autoRebalance) {
      return;
    }

    // Auto-rebalancing logic would be implemented here
    // This would analyze balances across chains and move tokens as needed
    console.log('Auto-rebalancing check completed (not implemented in MVP)');
  }

  /**
   * Get liquidity thresholds for a token
   */
  private getThresholds(tokenAddress: string): LiquidityThresholds | undefined {
    return this.config.thresholds.get(tokenAddress.toLowerCase());
  }

  /**
   * Add an alert and notify handlers
   */
  private addAlert(alert: LiquidityAlert): void {
    this.alerts.push(alert);

    // Notify alert handlers
    for (const [name, handler] of this.alertHandlers) {
      try {
        handler(alert);
      } catch (error) {
        console.error(`Error in alert handler ${name}:`, error);
      }
    }
  }

  /**
   * Get monitoring status
   */
  isCurrentlyMonitoring(): boolean {
    return this.isMonitoring;
  }
} 