// FinalizationEventListener.ts - Monitors finalization events on origin chains 

import { EventLog, Provider } from 'ethers';
import { SettlerCompactInterface, StandardOrder, FinalizationParams } from '../contracts/SettlerCompactInterface';
import { ContractFactory } from '../contracts/ContractFactory';

export interface FinalizationEventData {
  orderId: string;
  solver: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  gasUsed?: bigint;
  gasPrice?: bigint;
  totalGasCost?: bigint;
}

export interface SettlementTracking {
  orderId: string;
  solver: string;
  finalizationTime: number;
  settlementConfirmed: boolean;
  paymentReceived?: bigint;
  gasSpent: bigint;
  netProfit?: bigint;
}

export interface SolverPaymentInfo {
  solver: string;
  totalPayments: bigint;
  totalGasSpent: bigint;
  orderCount: number;
  averageProfit: bigint;
  profitableOrders: number;
  lastPayment?: FinalizationEventData;
}

export interface FinalizationEventConfig {
  chainId: number;
  startBlock?: number;
  trackSettlements?: boolean; // Track settlement completion
  trackPayments?: boolean; // Track solver payments
  calculateProfitability?: boolean; // Calculate net profits
  confirmationBlocks?: number; // Blocks to wait for confirmation
}

/**
 * Monitors finalization events on origin chains and tracks settlement completion
 * Handles settlement tracking and solver payment confirmation
 */
export class FinalizationEventListener {
  private settlerInterface: SettlerCompactInterface | null = null;
  private provider: Provider | null = null;
  private config: FinalizationEventConfig;
  private isListening = false;
  private stopFinalizationListener?: () => void;
  
  // Event handlers
  private finalizationHandlers: Map<string, (event: FinalizationEventData) => void> = new Map();
  private settlementHandlers: Map<string, (settlement: SettlementTracking) => void> = new Map();
  private paymentHandlers: Map<string, (payment: SolverPaymentInfo) => void> = new Map();
  
  // Settlement and payment tracking
  private settlements: Map<string, SettlementTracking> = new Map();
  private solverPayments: Map<string, SolverPaymentInfo> = new Map();
  private pendingConfirmations: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private contractFactory: ContractFactory,
    config: FinalizationEventConfig
  ) {
    this.config = {
      trackSettlements: true,
      trackPayments: true,
      calculateProfitability: true,
      confirmationBlocks: 3, // 3 block confirmations default
      ...config
    };
  }

  /**
   * Initialize the finalization event listener with contract and provider
   */
  async initialize(): Promise<void> {
    this.provider = this.contractFactory.getProvider(this.config.chainId);
    if (!this.provider) {
      throw new Error(`Provider not found for chain ${this.config.chainId}`);
    }

    const settlerContract = this.contractFactory.getContract('SettlerCompact', this.config.chainId);
    if (!settlerContract) {
      throw new Error(`SettlerCompact contract not found for chain ${this.config.chainId}`);
    }

    this.settlerInterface = new SettlerCompactInterface(settlerContract);
  }

  /**
   * Start listening for finalization events
   */
  async startListening(): Promise<void> {
    if (!this.settlerInterface || !this.provider) {
      throw new Error('FinalizationEventListener not initialized');
    }

    if (this.isListening) {
      console.log('FinalizationEventListener already listening');
      return;
    }

    console.log(`Starting finalization event listener on chain ${this.config.chainId}`);

    // Listen for order finalization events
    this.stopFinalizationListener = this.settlerInterface.onOrderFinalized(async (orderId, solver, event) => {
      try {
        const finalizationData = await this.processFinalizationEvent(orderId, solver, event);
        
        // Update settlement tracking
        if (this.config.trackSettlements) {
          await this.updateSettlementTracking(finalizationData);
        }

        // Update payment tracking
        if (this.config.trackPayments) {
          await this.updatePaymentTracking(finalizationData);
        }

        // Schedule confirmation tracking
        if (this.config.confirmationBlocks && this.config.confirmationBlocks > 0) {
          this.scheduleConfirmationCheck(finalizationData);
        }

        // Notify finalization handlers
        for (const [name, handler] of this.finalizationHandlers) {
          try {
            handler(finalizationData);
          } catch (error) {
            console.error(`Error in finalization handler ${name}:`, error);
          }
        }

        console.log(`Order ${orderId} finalized by solver ${solver}`);
      } catch (error) {
        console.error('Error processing finalization event:', error);
      }
    });

    this.isListening = true;
  }

  /**
   * Stop listening for events
   */
  stopListeningToEvents(): void {
    if (this.stopFinalizationListener) {
      this.stopFinalizationListener();
      this.stopFinalizationListener = undefined;
    }

    // Clear confirmation timers
    for (const timer of this.pendingConfirmations.values()) {
      clearTimeout(timer);
    }
    this.pendingConfirmations.clear();

    this.isListening = false;
    console.log(`Stopped finalization event listener on chain ${this.config.chainId}`);
  }

  /**
   * Register a handler for finalization events
   * @param name - Unique name for the handler
   * @param handler - Function to call when finalizations occur
   */
  registerFinalizationHandler(name: string, handler: (event: FinalizationEventData) => void): void {
    this.finalizationHandlers.set(name, handler);
  }

  /**
   * Register a handler for settlement tracking events
   * @param name - Unique name for the handler
   * @param handler - Function to call when settlements are tracked
   */
  registerSettlementHandler(name: string, handler: (settlement: SettlementTracking) => void): void {
    this.settlementHandlers.set(name, handler);
  }

  /**
   * Register a handler for payment tracking events
   * @param name - Unique name for the handler
   * @param handler - Function to call when payments are processed
   */
  registerPaymentHandler(name: string, handler: (payment: SolverPaymentInfo) => void): void {
    this.paymentHandlers.set(name, handler);
  }

  /**
   * Unregister handlers
   */
  unregisterFinalizationHandler(name: string): void {
    this.finalizationHandlers.delete(name);
  }

  unregisterSettlementHandler(name: string): void {
    this.settlementHandlers.delete(name);
  }

  unregisterPaymentHandler(name: string): void {
    this.paymentHandlers.delete(name);
  }

  /**
   * Get past finalization events
   * @param fromBlock - Starting block number
   * @param toBlock - Ending block number
   * @returns Array of processed finalization events
   */
  async getPastFinalizationEvents(fromBlock?: number, toBlock?: number): Promise<FinalizationEventData[]> {
    if (!this.settlerInterface) {
      throw new Error('FinalizationEventListener not initialized');
    }

    // Get OrderFinalized events
    const filter = this.settlerInterface.getContract().filters?.OrderFinalized?.();
    if (!filter) {
      throw new Error('OrderFinalized event filter not available');
    }

    const events = await this.settlerInterface.getContract().queryFilter(filter, fromBlock, toBlock);
    const processedEvents: FinalizationEventData[] = [];

    for (const event of events) {
      try {
        if (event instanceof EventLog) {
          // Extract finalization data from event
          const orderId = event.args?.[0] as string;
          const solver = event.args?.[1] as string;
          
          if (orderId && solver) {
            const finalizationData = await this.processFinalizationEvent(orderId, solver, event);
            processedEvents.push(finalizationData);
          }
        }
      } catch (error) {
        console.error('Error processing past finalization event:', error);
      }
    }

    return processedEvents;
  }

  /**
   * Get settlement tracking data for a specific order
   * @param orderId - Order identifier
   * @returns Settlement data or null if not found
   */
  getSettlement(orderId: string): SettlementTracking | null {
    return this.settlements.get(orderId) || null;
  }

  /**
   * Get all settlement tracking data
   * @returns Map of order IDs to settlement data
   */
  getAllSettlements(): Map<string, SettlementTracking> {
    return new Map(this.settlements);
  }

  /**
   * Get payment information for a specific solver
   * @param solver - Solver address
   * @returns Payment information or null if not found
   */
  getSolverPayments(solver: string): SolverPaymentInfo | null {
    return this.solverPayments.get(solver) || null;
  }

  /**
   * Get payment information for all solvers
   * @returns Map of solver addresses to payment information
   */
  getAllSolverPayments(): Map<string, SolverPaymentInfo> {
    return new Map(this.solverPayments);
  }

  /**
   * Calculate solver performance metrics
   * @param solver - Solver address
   * @returns Performance metrics
   */
  getSolverPerformance(solver: string): {
    totalOrders: number;
    profitableOrders: number;
    profitabilityRate: number;
    averageProfit: bigint;
    totalGasSpent: bigint;
    totalPayments: bigint;
  } | null {
    const payments = this.solverPayments.get(solver);
    if (!payments) {
      return null;
    }

    const profitabilityRate = payments.orderCount > 0 
      ? payments.profitableOrders / payments.orderCount 
      : 0;

    return {
      totalOrders: payments.orderCount,
      profitableOrders: payments.profitableOrders,
      profitabilityRate,
      averageProfit: payments.averageProfit,
      totalGasSpent: payments.totalGasSpent,
      totalPayments: payments.totalPayments
    };
  }

  /**
   * Process a single finalization event into structured data
   */
  private async processFinalizationEvent(orderId: string, solver: string, event: EventLog): Promise<FinalizationEventData> {
    if (!this.provider) {
      throw new Error('Provider not available');
    }

    // Get block and transaction details
    const block = await this.provider.getBlock(event.blockNumber);
    const timestamp = block?.timestamp || 0;

    // Get transaction receipt for gas details
    const receipt = await this.provider.getTransactionReceipt(event.transactionHash);
    const gasUsed = receipt?.gasUsed;

    // Get transaction details for gas price
    const tx = await this.provider.getTransaction(event.transactionHash);
    const gasPrice = tx?.gasPrice;

    // Calculate total gas cost
    const totalGasCost = gasUsed && gasPrice ? gasUsed * gasPrice : undefined;

    return {
      orderId,
      solver,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      timestamp,
      gasUsed,
      gasPrice,
      totalGasCost
    };
  }

  /**
   * Update settlement tracking for an order
   */
  private async updateSettlementTracking(finalizationData: FinalizationEventData): Promise<void> {
    const settlement: SettlementTracking = {
      orderId: finalizationData.orderId,
      solver: finalizationData.solver,
      finalizationTime: finalizationData.timestamp,
      settlementConfirmed: false, // Will be confirmed after confirmation blocks
      gasSpent: finalizationData.totalGasCost || BigInt(0)
    };

    this.settlements.set(finalizationData.orderId, settlement);

    // Notify settlement handlers
    for (const [name, handler] of this.settlementHandlers) {
      try {
        handler(settlement);
      } catch (error) {
        console.error(`Error in settlement handler ${name}:`, error);
      }
    }
  }

  /**
   * Update payment tracking for a solver
   */
  private async updatePaymentTracking(finalizationData: FinalizationEventData): Promise<void> {
    const { solver, totalGasCost } = finalizationData;
    
    let paymentInfo = this.solverPayments.get(solver);
    if (!paymentInfo) {
      paymentInfo = {
        solver,
        totalPayments: BigInt(0),
        totalGasSpent: BigInt(0),
        orderCount: 0,
        averageProfit: BigInt(0),
        profitableOrders: 0
      };
    }

    // Update statistics
    paymentInfo.orderCount++;
    paymentInfo.totalGasSpent += totalGasCost || BigInt(0);
    paymentInfo.lastPayment = finalizationData;

    // TODO: Calculate actual payment received from transaction details
    // For now, we estimate payment based on successful finalization
    const estimatedPayment = BigInt('50000000000000000'); // 0.05 ETH placeholder
    paymentInfo.totalPayments += estimatedPayment;

    // Calculate net profit (payment - gas cost)
    const netProfit = estimatedPayment - (totalGasCost || BigInt(0));
    if (netProfit > 0) {
      paymentInfo.profitableOrders++;
    }

    // Update average profit
    paymentInfo.averageProfit = paymentInfo.orderCount > 0 
      ? paymentInfo.totalPayments / BigInt(paymentInfo.orderCount)
      : BigInt(0);

    this.solverPayments.set(solver, paymentInfo);

    // Notify payment handlers
    for (const [name, handler] of this.paymentHandlers) {
      try {
        handler(paymentInfo);
      } catch (error) {
        console.error(`Error in payment handler ${name}:`, error);
      }
    }
  }

  /**
   * Schedule confirmation check after required blocks
   */
  private scheduleConfirmationCheck(finalizationData: FinalizationEventData): void {
    if (!this.provider) {
      return;
    }

    const confirmationDelay = (this.config.confirmationBlocks || 3) * 15000; // Assume 15 second blocks

    const timer = setTimeout(async () => {
      try {
        const currentBlock = await this.provider!.getBlockNumber();
        const confirmations = currentBlock - finalizationData.blockNumber;

        if (confirmations >= this.config.confirmationBlocks!) {
          // Mark settlement as confirmed
          const settlement = this.settlements.get(finalizationData.orderId);
          if (settlement) {
            settlement.settlementConfirmed = true;
            console.log(`Settlement confirmed for order ${finalizationData.orderId} with ${confirmations} confirmations`);
          }
        }
      } catch (error) {
        console.error('Error checking confirmations:', error);
      } finally {
        this.pendingConfirmations.delete(finalizationData.orderId);
      }
    }, confirmationDelay);

    this.pendingConfirmations.set(finalizationData.orderId, timer);
  }

  /**
   * Get current listening status
   */
  isCurrentlyListening(): boolean {
    return this.isListening;
  }

  /**
   * Get current configuration
   */
  getConfig(): FinalizationEventConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart if currently listening)
   */
  updateConfig(newConfig: Partial<FinalizationEventConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.isListening) {
      console.log('Configuration updated. Restart listener to apply changes.');
    }
  }
} 