// CoinFillerInterface.ts - Type-safe interface for CoinFiller contract 

import { Contract, ContractTransactionResponse, EventLog, BigNumberish } from 'ethers';

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

export interface FillParams {
  fillDeadline: number;
  orderId: string;
  output: MandateOutput;
  solverIdentifier: string;
}

export interface FillResult {
  transaction: ContractTransactionResponse;
  orderId: string;
  solver: string;
}

/**
 * Type-safe interface for CoinFiller contract operations
 * Handles order filling on destination chains for the OIF protocol
 */
export class CoinFillerInterface {
  constructor(private contract: Contract) {}

  /**
   * Fill an order on the destination chain
   * @param params - Fill parameters including deadline, order ID, output, and solver
   * @returns Fill result with transaction and details
   */
  async fill(params: FillParams): Promise<FillResult> {
    if (!this.contract.fill) {
      throw new Error('fill method not found on contract');
    }

    const tx = await this.contract.fill(
      params.fillDeadline,
      params.orderId,
      params.output,
      params.solverIdentifier
    );

    return {
      transaction: tx,
      orderId: params.orderId,
      solver: params.solverIdentifier
    };
  }

  /**
   * Fill an order with simplified parameters (matching Step2 automation script)
   * @param fillDeadline - Maximum deadline for fill
   * @param orderId - Order identifier (bytes32)
   * @param output - MandateOutput structure
   * @param solverIdentifier - Solver identifier (bytes32)
   * @returns Transaction response
   */
  async fillOrder(
    fillDeadline: number,
    orderId: string,
    output: MandateOutput,
    solverIdentifier: string
  ): Promise<ContractTransactionResponse> {
    if (!this.contract.fill) {
      throw new Error('fill method not found on contract');
    }

    return await this.contract.fill(fillDeadline, orderId, output, solverIdentifier);
  }

  /**
   * Listen for order fill events
   * @param callback - Function to call when order is filled
   * @returns Function to stop listening
   */
  onOrderFilled(callback: (orderId: string, solver: string, amount: bigint, event: EventLog) => void): () => void {
    const filter = this.contract.filters?.OrderFilled?.();
    if (!filter) {
      throw new Error('OrderFilled event filter not available');
    }

    const listener = (orderId: string, solver: string, amount: bigint, event: EventLog) => {
      callback(orderId, solver, amount, event);
    };

    this.contract.on(filter, listener);
    
    return () => {
      this.contract.off(filter, listener);
    };
  }

  /**
   * Listen for fill failure events
   * @param callback - Function to call when fill fails
   * @returns Function to stop listening
   */
  onFillFailed(callback: (orderId: string, reason: string, event: EventLog) => void): () => void {
    const filter = this.contract.filters?.FillFailed?.();
    if (!filter) {
      throw new Error('FillFailed event filter not available');
    }

    const listener = (orderId: string, reason: string, event: EventLog) => {
      callback(orderId, reason, event);
    };

    this.contract.on(filter, listener);
    
    return () => {
      this.contract.off(filter, listener);
    };
  }

  /**
   * Get past order fill events
   * @param fromBlock - Starting block number
   * @param toBlock - Ending block number
   * @returns Array of fill events
   */
  async getFillEvents(fromBlock?: number, toBlock?: number): Promise<EventLog[]> {
    const filter = this.contract.filters?.OrderFilled?.();
    if (!filter) {
      throw new Error('OrderFilled event filter not available');
    }

    const events = await this.contract.queryFilter(filter, fromBlock, toBlock);
    return events.filter((event): event is EventLog => event instanceof EventLog);
  }

  /**
   * Check if an order can be filled
   * @param orderId - Order identifier
   * @param solver - Solver address
   * @returns True if order can be filled
   */
  async canFill(orderId: string, solver: string): Promise<boolean> {
    try {
      if (!this.contract.canFill) {
        // If method doesn't exist, assume we can try to fill
        return true;
      }
      return await this.contract.canFill(orderId, solver);
    } catch {
      return false;
    }
  }

  /**
   * Get fill status for an order
   * @param orderId - Order identifier
   * @returns Fill status information
   */
  async getFillStatus(orderId: string): Promise<{ filled: boolean; solver?: string; amount?: bigint }> {
    try {
      if (!this.contract.getFillStatus) {
        return { filled: false };
      }
      const result = await this.contract.getFillStatus(orderId);
      return {
        filled: result.filled || false,
        solver: result.solver,
        amount: result.amount ? BigInt(result.amount.toString()) : undefined
      };
    } catch {
      return { filled: false };
    }
  }

  /**
   * Estimate gas for fill operation
   * @param params - Fill parameters
   * @returns Estimated gas amount
   */
  async estimateFillGas(params: FillParams): Promise<bigint> {
    try {
      if (!this.contract.fill?.estimateGas) {
        throw new Error('Gas estimation not available');
      }

      const gasEstimate = await this.contract.fill.estimateGas(
        params.fillDeadline,
        params.orderId,
        params.output,
        params.solverIdentifier
      );
      
      return BigInt(gasEstimate.toString());
    } catch (error) {
      throw new Error(`Gas estimation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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