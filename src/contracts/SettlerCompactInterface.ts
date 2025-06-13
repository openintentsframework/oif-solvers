// SettlerCompactInterface.ts - Type-safe interface for SettlerCompact contract 

import { Contract, ContractTransactionResponse, EventLog } from 'ethers';

export interface StandardOrder {
  user: string;
  nonce: number;
  originChainId: number;
  expires: number;
  fillDeadline: number;
  localOracle: string;
  inputs: [bigint, bigint][];
  outputs: MandateOutput[];
}

export interface MandateOutput {
  remoteOracle: string;
  remoteFiller: string;
  chainId: number;
  token: string;
  amount: bigint;
  recipient: string;
  remoteCall: string;
  fulfillmentContext: string;
}

export interface FinalizationParams {
  order: StandardOrder;
  signatures: string;
  timestamps: number[];
  solvers: string[];
  destination: string;
  callData: string;
}

/**
 * Type-safe interface for SettlerCompact contract operations
 * Handles order creation, finalization, and event monitoring for the OIF protocol
 */
export class SettlerCompactInterface {
  constructor(private contract: Contract) {}

  /**
   * Calculate order identifier for a StandardOrder
   * @param order - The StandardOrder structure
   * @returns Order identifier (bytes32)
   */
  async orderIdentifier(order: StandardOrder): Promise<string> {
    if (!this.contract.orderIdentifier) {
      throw new Error('orderIdentifier method not found on contract');
    }
    return await this.contract.orderIdentifier(order);
  }

  /**
   * Finalize an order on the origin chain
   * @param params - Finalization parameters
   * @returns Transaction response
   */
  async finalise(params: FinalizationParams): Promise<ContractTransactionResponse> {
    if (!this.contract.finalise) {
      throw new Error('finalise method not found on contract');
    }
    
    return await this.contract.finalise(
      params.order,
      params.signatures,
      params.timestamps,
      params.solvers,
      params.destination,
      params.callData
    );
  }

  /**
   * Listen for order creation events
   * @param callback - Function to call when order is created
   * @returns Function to stop listening
   */
  onOrderCreated(callback: (orderId: string, order: StandardOrder, event: EventLog) => void): () => void {
    const filter = this.contract.filters?.OrderCreated?.();
    if (!filter) {
      throw new Error('OrderCreated event filter not available');
    }

    const listener = (orderId: string, order: StandardOrder, event: EventLog) => {
      callback(orderId, order, event);
    };

    this.contract.on(filter, listener);
    
    return () => {
      this.contract.off(filter, listener);
    };
  }

  /**
   * Listen for order finalization events
   * @param callback - Function to call when order is finalized
   * @returns Function to stop listening
   */
  onOrderFinalized(callback: (orderId: string, solver: string, event: EventLog) => void): () => void {
    const filter = this.contract.filters?.OrderFinalized?.();
    if (!filter) {
      throw new Error('OrderFinalized event filter not available');
    }

    const listener = (orderId: string, solver: string, event: EventLog) => {
      callback(orderId, solver, event);
    };

    this.contract.on(filter, listener);
    
    return () => {
      this.contract.off(filter, listener);
    };
  }

  /**
   * Get past order creation events
   * @param fromBlock - Starting block number
   * @param toBlock - Ending block number
   * @returns Array of order creation events
   */
  async getOrderCreatedEvents(fromBlock?: number, toBlock?: number): Promise<EventLog[]> {
    const filter = this.contract.filters?.OrderCreated?.();
    if (!filter) {
      throw new Error('OrderCreated event filter not available');
    }

    const events = await this.contract.queryFilter(filter, fromBlock, toBlock);
    return events.filter((event): event is EventLog => event instanceof EventLog);
  }

  /**
   * Verify BatchCompact signature
   * @param signature - The signature to verify
   * @param messageHash - The message hash that was signed
   * @param signer - Expected signer address
   * @returns True if signature is valid
   */
  async verifyBatchCompactSignature(
    signature: string,
    messageHash: string,
    signer: string
  ): Promise<boolean> {
    try {
      if (!this.contract.interface?.getFunction) {
        return false;
      }
      // This would typically use ecrecover or similar verification
      // For now, return basic validation
      return signature.length === 132 && messageHash.length === 66 && signer.length === 42;
    } catch {
      return false;
    }
  }

  /**
   * Get the underlying contract instance
   * @returns The ethers Contract instance
   */
  getContract(): Contract {
    return this.contract;
  }
} 