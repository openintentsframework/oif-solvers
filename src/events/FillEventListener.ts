// FillEventListener.ts - Monitors order fill events on destination chains 

import { EventLog, Provider } from 'ethers';
import { CoinFillerInterface, MandateOutput } from '../contracts/CoinFillerInterface';
import { ContractFactory } from '../contracts/ContractFactory';

export interface FillEventData {
  orderId: string;
  solver: string;
  amount: bigint;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  gasUsed?: bigint;
  gasPrice?: bigint;
}

export interface FillFailureData {
  orderId: string;
  reason: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
}

export interface SolverCompetition {
  orderId: string;
  solvers: string[];
  fillTimes: Map<string, number>;
  winner?: string;
  totalAttempts: number;
  failedAttempts: number;
}

export interface FillEventConfig {
  chainId: number;
  startBlock?: number;
  trackCompetition?: boolean; // Track competition between solvers
  maxCompetitionWindow?: number; // Time window in seconds to track competition
  monitorFailures?: boolean; // Monitor fill failures
}

/**
 * Monitors order fill events on destination chains and tracks completion
 * Handles fill confirmation and solver competition tracking
 */
export class FillEventListener {
  private coinFillerInterface: CoinFillerInterface | null = null;
  private provider: Provider | null = null;
  private config: FillEventConfig;
  private isListening = false;
  private stopFillListener?: () => void;
  private stopFailureListener?: () => void;
  
  // Event handlers
  private fillHandlers: Map<string, (event: FillEventData) => void> = new Map();
  private failureHandlers: Map<string, (event: FillFailureData) => void> = new Map();
  private competitionHandlers: Map<string, (competition: SolverCompetition) => void> = new Map();
  
  // Competition tracking
  private competitions: Map<string, SolverCompetition> = new Map();
  private competitionTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private contractFactory: ContractFactory,
    config: FillEventConfig
  ) {
    this.config = {
      trackCompetition: true,
      maxCompetitionWindow: 300, // 5 minutes default
      monitorFailures: true,
      ...config
    };
  }

  /**
   * Initialize the fill event listener with contract and provider
   */
  async initialize(): Promise<void> {
    this.provider = this.contractFactory.getProvider(this.config.chainId);
    if (!this.provider) {
      throw new Error(`Provider not found for chain ${this.config.chainId}`);
    }

    const coinFillerContract = this.contractFactory.getContract('CoinFiller', this.config.chainId);
    if (!coinFillerContract) {
      throw new Error(`CoinFiller contract not found for chain ${this.config.chainId}`);
    }

    this.coinFillerInterface = new CoinFillerInterface(coinFillerContract);
  }

  /**
   * Start listening for fill events
   */
  async startListening(): Promise<void> {
    if (!this.coinFillerInterface || !this.provider) {
      throw new Error('FillEventListener not initialized');
    }

    if (this.isListening) {
      console.log('FillEventListener already listening');
      return;
    }

    console.log(`Starting fill event listener on chain ${this.config.chainId}`);

    // Listen for successful fills
    this.stopFillListener = this.coinFillerInterface.onOrderFilled(async (orderId, solver, amount, event) => {
      try {
        const fillData = await this.processFillEvent(orderId, solver, amount, event);
        
        // Update competition tracking
        if (this.config.trackCompetition) {
          this.updateCompetition(orderId, solver, fillData.timestamp, true);
        }

        // Notify fill handlers
        for (const [name, handler] of this.fillHandlers) {
          try {
            handler(fillData);
          } catch (error) {
            console.error(`Error in fill handler ${name}:`, error);
          }
        }

        console.log(`Order ${orderId} filled by solver ${solver} for ${amount} tokens`);
      } catch (error) {
        console.error('Error processing fill event:', error);
      }
    });

    // Listen for fill failures if enabled
    if (this.config.monitorFailures) {
      this.stopFailureListener = this.coinFillerInterface.onFillFailed(async (orderId, reason, event) => {
        try {
          const failureData = await this.processFailureEvent(orderId, reason, event);
          
          // Update competition tracking for failed attempts
          if (this.config.trackCompetition) {
            this.updateCompetition(orderId, 'unknown', failureData.timestamp, false);
          }

          // Notify failure handlers
          for (const [name, handler] of this.failureHandlers) {
            try {
              handler(failureData);
            } catch (error) {
              console.error(`Error in failure handler ${name}:`, error);
            }
          }

          console.log(`Order ${orderId} fill failed: ${reason}`);
        } catch (error) {
          console.error('Error processing failure event:', error);
        }
      });
    }

    this.isListening = true;
  }

  /**
   * Stop listening for events
   */
  stopListeningToEvents(): void {
    if (this.stopFillListener) {
      this.stopFillListener();
      this.stopFillListener = undefined;
    }

    if (this.stopFailureListener) {
      this.stopFailureListener();
      this.stopFailureListener = undefined;
    }

    // Clear competition timers
    for (const timer of this.competitionTimers.values()) {
      clearTimeout(timer);
    }
    this.competitionTimers.clear();

    this.isListening = false;
    console.log(`Stopped fill event listener on chain ${this.config.chainId}`);
  }

  /**
   * Register a handler for fill events
   * @param name - Unique name for the handler
   * @param handler - Function to call when fills occur
   */
  registerFillHandler(name: string, handler: (event: FillEventData) => void): void {
    this.fillHandlers.set(name, handler);
  }

  /**
   * Register a handler for fill failure events
   * @param name - Unique name for the handler
   * @param handler - Function to call when fills fail
   */
  registerFailureHandler(name: string, handler: (event: FillFailureData) => void): void {
    this.failureHandlers.set(name, handler);
  }

  /**
   * Register a handler for competition events
   * @param name - Unique name for the handler
   * @param handler - Function to call when competition completes
   */
  registerCompetitionHandler(name: string, handler: (competition: SolverCompetition) => void): void {
    this.competitionHandlers.set(name, handler);
  }

  /**
   * Unregister handlers
   */
  unregisterFillHandler(name: string): void {
    this.fillHandlers.delete(name);
  }

  unregisterFailureHandler(name: string): void {
    this.failureHandlers.delete(name);
  }

  unregisterCompetitionHandler(name: string): void {
    this.competitionHandlers.delete(name);
  }

  /**
   * Get past fill events
   * @param fromBlock - Starting block number
   * @param toBlock - Ending block number
   * @returns Array of processed fill events
   */
  async getPastFillEvents(fromBlock?: number, toBlock?: number): Promise<FillEventData[]> {
    if (!this.coinFillerInterface) {
      throw new Error('FillEventListener not initialized');
    }

    const events = await this.coinFillerInterface.getFillEvents(fromBlock, toBlock);
    const processedEvents: FillEventData[] = [];

    for (const event of events) {
      try {
        // Extract fill data from event
        const orderId = event.args?.[0] as string;
        const solver = event.args?.[1] as string;
        const amount = event.args?.[2] as bigint;
        
        if (orderId && solver && amount !== undefined) {
          const fillData = await this.processFillEvent(orderId, solver, amount, event);
          processedEvents.push(fillData);
        }
      } catch (error) {
        console.error('Error processing past fill event:', error);
      }
    }

    return processedEvents;
  }

  /**
   * Get competition data for a specific order
   * @param orderId - Order identifier
   * @returns Competition data or null if not found
   */
  getCompetition(orderId: string): SolverCompetition | null {
    return this.competitions.get(orderId) || null;
  }

  /**
   * Get all active competitions
   * @returns Map of order IDs to competition data
   */
  getAllCompetitions(): Map<string, SolverCompetition> {
    return new Map(this.competitions);
  }

  /**
   * Check if an order has been filled
   * @param orderId - Order identifier
   * @returns Fill status
   */
  async isOrderFilled(orderId: string): Promise<{ filled: boolean; solver?: string; amount?: bigint }> {
    if (!this.coinFillerInterface) {
      throw new Error('FillEventListener not initialized');
    }

    return await this.coinFillerInterface.getFillStatus(orderId);
  }

  /**
   * Process a single fill event into structured data
   */
  private async processFillEvent(orderId: string, solver: string, amount: bigint, event: EventLog): Promise<FillEventData> {
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

    return {
      orderId,
      solver,
      amount,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      timestamp,
      gasUsed,
      gasPrice
    };
  }

  /**
   * Process a single failure event into structured data
   */
  private async processFailureEvent(orderId: string, reason: string, event: EventLog): Promise<FillFailureData> {
    if (!this.provider) {
      throw new Error('Provider not available');
    }

    // Get block details
    const block = await this.provider.getBlock(event.blockNumber);
    const timestamp = block?.timestamp || 0;

    return {
      orderId,
      reason,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      timestamp
    };
  }

  /**
   * Update competition tracking for an order
   */
  private updateCompetition(orderId: string, solver: string, timestamp: number, success: boolean): void {
    if (!this.config.trackCompetition) {
      return;
    }

    let competition = this.competitions.get(orderId);
    
    if (!competition) {
      competition = {
        orderId,
        solvers: [],
        fillTimes: new Map(),
        totalAttempts: 0,
        failedAttempts: 0
      };
      this.competitions.set(orderId, competition);
    }

    // Update statistics
    competition.totalAttempts++;
    if (!success) {
      competition.failedAttempts++;
    }

    // Track solver participation
    if (solver !== 'unknown' && !competition.solvers.includes(solver)) {
      competition.solvers.push(solver);
    }

    if (success && solver !== 'unknown') {
      competition.fillTimes.set(solver, timestamp);
      competition.winner = solver;
      
      // Competition is complete, notify handlers and clean up
      this.finalizeCompetition(orderId, competition);
    } else {
      // Set a timer to finalize competition if no success within window
      this.setCompetitionTimer(orderId, competition);
    }
  }

  /**
   * Set a timer to finalize competition after window expires
   */
  private setCompetitionTimer(orderId: string, competition: SolverCompetition): void {
    // Clear existing timer
    const existingTimer = this.competitionTimers.get(orderId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.finalizeCompetition(orderId, competition);
    }, this.config.maxCompetitionWindow! * 1000);

    this.competitionTimers.set(orderId, timer);
  }

  /**
   * Finalize competition and notify handlers
   */
  private finalizeCompetition(orderId: string, competition: SolverCompetition): void {
    // Clear timer
    const timer = this.competitionTimers.get(orderId);
    if (timer) {
      clearTimeout(timer);
      this.competitionTimers.delete(orderId);
    }

    // Notify competition handlers
    for (const [name, handler] of this.competitionHandlers) {
      try {
        handler(competition);
      } catch (error) {
        console.error(`Error in competition handler ${name}:`, error);
      }
    }

    console.log(`Competition completed for order ${orderId}: ${competition.winner ? `Won by ${competition.winner}` : 'No winner'}`);
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
  getConfig(): FillEventConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart if currently listening)
   */
  updateConfig(newConfig: Partial<FillEventConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.isListening) {
      console.log('Configuration updated. Restart listener to apply changes.');
    }
  }
} 