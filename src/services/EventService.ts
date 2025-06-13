import { ethers } from 'ethers';
import { ContractFactory } from '../contracts/ContractFactory';

// Basic event data structures
export interface OrderEvent {
  orderId: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  chainId: number;
  eventType: 'OrderCreated' | 'OrderFilled' | 'OrderFinalized' | 'OracleClaimed' | 'OracleVerified';
  data: any;
}

// Event listener configuration
export interface EventListenerConfig {
  startBlock?: number;
  confirmations?: number;
  pollingInterval?: number;
}

// Event handlers
export type EventHandler = (event: OrderEvent) => void | Promise<void>;

/**
 * Event Service for monitoring blockchain events across all OIF contracts
 * Provides centralized event coordination and filtering
 */
export class EventService {
  private contractFactory: ContractFactory;
  private activeListeners: Map<string, () => void> = new Map();
  private config: EventListenerConfig;
  private isStarted: boolean = false;
  private eventHandlers: EventHandler[] = [];

  constructor(contractFactory: ContractFactory, config: EventListenerConfig = {}) {
    this.contractFactory = contractFactory;
    this.config = {
      startBlock: config.startBlock,
      confirmations: config.confirmations || 1,
      pollingInterval: config.pollingInterval || 5000,
      ...config
    };
  }

  /**
   * Start all event listeners
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('Event service is already started');
    }

    console.log('Starting Event Service...');

    try {
      // Start listeners for all configured chains
      const chainIds = this.contractFactory.getChainIds();
      
      for (const chainId of chainIds) {
        await this.startChainListeners(chainId);
      }

      this.isStarted = true;
      console.log(`Event Service started for ${chainIds.length} chains`);
    } catch (error) {
      console.error('Failed to start Event Service:', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop all event listeners
   */
  async stop(): Promise<void> {
    console.log('Stopping Event Service...');

    // Remove all active listeners
    for (const [listenerKey, cleanup] of this.activeListeners) {
      try {
        cleanup();
        console.log(`Stopped listener: ${listenerKey}`);
      } catch (error) {
        console.error(`Error stopping listener ${listenerKey}:`, error);
      }
    }

    this.activeListeners.clear();
    this.isStarted = false;
    console.log('Event Service stopped');
  }

  /**
   * Start event listeners for a specific chain
   */
  private async startChainListeners(chainId: number): Promise<void> {
    try {
      // Start SettlerCompact listeners
      await this.startContractListeners(chainId, 'SettlerCompact', [
        'OrderCreated',
        'OrderFinalized'
      ]);

      // Start CoinFiller listeners
      await this.startContractListeners(chainId, 'CoinFiller', [
        'OrderFilled'
      ]);

      // Start Oracle listeners
      await this.startContractListeners(chainId, 'BitcoinOracle', [
        'OutputClaimed',
        'OutputFilled'
      ]);

      console.log(`Started event listeners for chain ${chainId}`);
    } catch (error) {
      console.error(`Failed to start listeners for chain ${chainId}:`, error);
      // Don't throw - some contracts might not exist on this chain
    }
  }

  /**
   * Start listeners for a specific contract
   */
  private async startContractListeners(
    chainId: number, 
    contractName: string, 
    eventNames: string[]
  ): Promise<void> {
    try {
      const contract = this.contractFactory.getContract(contractName, chainId);
      const provider = this.contractFactory.getProvider(chainId);

      for (const eventName of eventNames) {
        try {
          const filter = contract.filters[eventName]?.();
          if (!filter) {
            console.warn(`Event ${eventName} not found on ${contractName}`);
            continue;
          }

          const listener = async (...args: any[]) => {
            const eventLog = args[args.length - 1]; // Last argument is usually the event log
            
            const event: OrderEvent = {
              orderId: args[0] || 'unknown',
              blockNumber: eventLog?.blockNumber || 0,
              transactionHash: eventLog?.transactionHash || '',
              timestamp: Math.floor(Date.now() / 1000),
              chainId,
              eventType: this.mapEventType(eventName),
              data: args.slice(0, -1) // All arguments except the event log
            };

            await this.handleEvent(event);
          };

          contract.on(filter, listener);
          
          const cleanup = () => {
            contract.off(filter, listener);
          };

          this.activeListeners.set(`${contractName}-${eventName}-${chainId}`, cleanup);
          console.log(`Started listening to ${contractName}.${eventName} on chain ${chainId}`);

        } catch (error) {
          console.warn(`Failed to start listener for ${contractName}.${eventName}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Contract ${contractName} not available on chain ${chainId}`);
    }
  }

  /**
   * Map event name to event type
   */
  private mapEventType(eventName: string): OrderEvent['eventType'] {
    switch (eventName) {
      case 'OrderCreated': return 'OrderCreated';
      case 'OrderFilled': return 'OrderFilled';
      case 'OrderFinalized': return 'OrderFinalized';
      case 'OutputClaimed': return 'OracleClaimed';
      case 'OutputFilled': return 'OracleVerified';
      default: return 'OrderCreated';
    }
  }

  /**
   * Handle incoming events
   */
  private async handleEvent(event: OrderEvent): Promise<void> {
    console.log(`Event ${event.eventType}: ${event.orderId} on chain ${event.chainId}`);
    
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${event.eventType}:`, error);
      }
    }
  }

  /**
   * Register event handler
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Register event handler for specific event type
   */
  onEventType(eventType: OrderEvent['eventType'], handler: EventHandler): () => void {
    const wrappedHandler = (event: OrderEvent) => {
      if (event.eventType === eventType) {
        return handler(event);
      }
    };

    return this.onEvent(wrappedHandler);
  }

  /**
   * Get current event service status
   */
  getStatus(): { started: boolean; activeListeners: number; chainCount: number } {
    return {
      started: this.isStarted,
      activeListeners: this.activeListeners.size,
      chainCount: this.contractFactory.getChainIds().length
    };
  }

  /**
   * Get historical events for a specific chain and contract
   */
  async getHistoricalEvents(
    chainId: number,
    contractName: string,
    eventName: string,
    fromBlock?: number,
    toBlock?: number | string
  ): Promise<OrderEvent[]> {
    try {
      const contract = this.contractFactory.getContract(contractName, chainId);
      const filter = contract.filters[eventName]?.();
      
      if (!filter) {
        console.warn(`Event ${eventName} not found on ${contractName}`);
        return [];
      }

      const events = await contract.queryFilter(filter, fromBlock, toBlock);
      
      return events.map((eventLog: any, index: number) => ({
        orderId: eventLog.args?.[0] || `historical-${index}`,
        blockNumber: eventLog.blockNumber,
        transactionHash: eventLog.transactionHash,
        timestamp: Math.floor(Date.now() / 1000), // Would typically get from block
        chainId,
        eventType: this.mapEventType(eventName),
        data: eventLog.args ? Array.from(eventLog.args) : []
      }));
    } catch (error) {
      console.error(`Failed to get historical events for ${contractName}.${eventName}:`, error);
      return [];
    }
  }

  /**
   * Check if event service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if all providers are responsive
      const chainIds = this.contractFactory.getChainIds();
      
      for (const chainId of chainIds) {
        const provider = this.contractFactory.getProvider(chainId);
        await provider.getBlockNumber();
      }

      return this.isStarted && this.activeListeners.size > 0;
    } catch (error) {
      console.error('Event service health check failed:', error);
      return false;
    }
  }

  /**
   * Filter events by chain ID
   */
  onChainEvents(chainId: number, handler: EventHandler): () => void {
    const wrappedHandler = (event: OrderEvent) => {
      if (event.chainId === chainId) {
        return handler(event);
      }
    };

    return this.onEvent(wrappedHandler);
  }

  /**
   * Filter events by order ID
   */
  onOrderEvents(orderId: string, handler: EventHandler): () => void {
    const wrappedHandler = (event: OrderEvent) => {
      if (event.orderId === orderId) {
        return handler(event);
      }
    };

    return this.onEvent(wrappedHandler);
  }
} 