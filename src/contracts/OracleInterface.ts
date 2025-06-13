// OracleInterface.ts - Interface for oracle contracts 
import { ethers } from 'ethers';
import { MandateOutput } from '../models/MandateOutput';

// Oracle-specific data structures
export interface ClaimedOrder {
  solver: string;
  claimTimestamp: number;
  multiplier: bigint;
  sponsor: string;
  disputer: string;
  disputeTimestamp: number;
}

export interface ClaimParams {
  solver: string;
  orderId: string;
  output: MandateOutput;
}

export interface ClaimResult {
  txHash: string;
  outputId: string;
  collateralAmount: bigint;
}

export interface DisputeParams {
  orderId: string;
  output: MandateOutput;
  challengerCollateral: bigint;
}

export interface DisputeResult {
  txHash: string;
  outputId: string;
  disputeTimestamp: number;
}

export interface VerificationParams {
  orderId: string;
  output: MandateOutput;
  blockNum: bigint;
  inclusionProof: any; // BtcTxProof structure
  txOutIx: bigint;
  previousBlockHeader?: string;
}

export interface VerificationResult {
  txHash: string;
  outputHash: string;
  verified: boolean;
}

export interface OptimisticVerificationParams {
  orderId: string;
  output: MandateOutput;
}

/**
 * Oracle Interface for interacting with Oracle contracts
 * Handles order claiming, verification, disputes, and optimistic verification
 */
export class OracleInterface {
  private contract: ethers.Contract;
  private provider: ethers.Provider;

  constructor(contract: ethers.Contract, provider: ethers.Provider) {
    this.contract = contract;
    this.provider = provider;
  }

  // Core Oracle Operations

  /**
   * Claim an order for verification
   * @param params Claim parameters
   * @returns Promise with claim result
   */
  async claim(params: ClaimParams): Promise<ClaimResult> {
    if (!this.contract.claim) {
      throw new Error('claim method not available on contract');
    }

    const tx = await this.contract.claim(
      params.solver,
      params.orderId,
      params.output
    );

    const receipt = await tx.wait();
    const outputId = await this.outputIdentifier(params.output);
    
    // Calculate collateral amount from output and multiplier
    const multiplier = await this.getCollateralMultiplier();
    const collateralAmount = BigInt(params.output.amount) * multiplier;

    return {
      txHash: receipt.hash,
      outputId,
      collateralAmount
    };
  }

  /**
   * Dispute a claimed order
   * @param params Dispute parameters
   * @returns Promise with dispute result
   */
  async dispute(params: DisputeParams): Promise<DisputeResult> {
    if (!this.contract.dispute) {
      throw new Error('dispute method not available on contract');
    }

    const tx = await this.contract.dispute(
      params.orderId,
      params.output
    );

    const receipt = await tx.wait();
    const outputId = await this.outputIdentifier(params.output);
    
    return {
      txHash: receipt.hash,
      outputId,
      disputeTimestamp: Math.floor(Date.now() / 1000)
    };
  }

  /**
   * Verify an order with proof
   * @param params Verification parameters
   * @returns Promise with verification result
   */
  async verify(params: VerificationParams): Promise<VerificationResult> {
    if (!this.contract.verify) {
      throw new Error('verify method not available on contract');
    }

    let tx;
    if (params.previousBlockHeader) {
      tx = await this.contract.verify(
        params.orderId,
        params.output,
        params.blockNum,
        params.inclusionProof,
        params.txOutIx,
        params.previousBlockHeader
      );
    } else {
      tx = await this.contract.verify(
        params.orderId,
        params.output,
        params.blockNum,
        params.inclusionProof,
        params.txOutIx
      );
    }

    const receipt = await tx.wait();
    const outputHash = await this.getOutputHash(params.orderId, params.output);

    return {
      txHash: receipt.hash,
      outputHash,
      verified: true
    };
  }

  /**
   * Optimistically verify an order after dispute period
   * @param params Optimistic verification parameters
   * @returns Promise with transaction hash
   */
  async optimisticallyVerify(params: OptimisticVerificationParams): Promise<string> {
    if (!this.contract.optimisticallyVerify) {
      throw new Error('optimisticallyVerify method not available on contract');
    }

    const tx = await this.contract.optimisticallyVerify(
      params.orderId,
      params.output
    );

    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Finalize a dispute if order hasn't been proven
   * @param orderId Order identifier
   * @param output Mandate output
   * @returns Promise with transaction hash
   */
  async finalizeDispute(orderId: string, output: MandateOutput): Promise<string> {
    if (!this.contract.finaliseDispute) {
      throw new Error('finaliseDispute method not available on contract');
    }

    const tx = await this.contract.finaliseDispute(orderId, output);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // Status and Query Methods

  /**
   * Get output identifier for a mandate output
   * @param output Mandate output
   * @returns Promise with output identifier
   */
  async outputIdentifier(output: MandateOutput): Promise<string> {
    if (!this.contract.outputIdentifier) {
      throw new Error('outputIdentifier method not available on contract');
    }

    return await this.contract.outputIdentifier(output);
  }

  /**
   * Get claimed order details
   * @param orderId Order identifier
   * @param outputId Output identifier
   * @returns Promise with claimed order details
   */
  async getClaimedOrder(orderId: string, outputId: string): Promise<ClaimedOrder> {
    if (!this.contract._claimedOrder) {
      throw new Error('_claimedOrder method not available on contract');
    }

    const result = await this.contract._claimedOrder(orderId, outputId);
    
    return {
      solver: result.solver,
      claimTimestamp: Number(result.claimTimestamp),
      multiplier: BigInt(result.multiplier),
      sponsor: result.sponsor,
      disputer: result.disputer,
      disputeTimestamp: Number(result.disputeTimestamp)
    };
  }

  /**
   * Check if payload hash is valid/verified
   * @param payloadHashes Array of payload hashes
   * @returns Promise with validity status
   */
  async arePayloadsValid(payloadHashes: string[]): Promise<boolean> {
    if (!this.contract.arePayloadsValid) {
      throw new Error('arePayloadsValid method not available on contract');
    }

    return await this.contract.arePayloadsValid(payloadHashes);
  }

  /**
   * Check if data has been proven by oracle
   * @param remoteChainId Remote chain ID
   * @param remoteOracle Remote oracle identifier
   * @param application Application identifier
   * @param dataHash Data hash
   * @returns Promise with proven status
   */
  async isProven(
    remoteChainId: bigint,
    remoteOracle: string,
    application: string,
    dataHash: string
  ): Promise<boolean> {
    if (!this.contract.isProven) {
      throw new Error('isProven method not available on contract');
    }

    return await this.contract.isProven(
      remoteChainId,
      remoteOracle,
      application,
      dataHash
    );
  }

  /**
   * Get collateral multiplier
   * @returns Promise with multiplier value
   */
  async getCollateralMultiplier(): Promise<bigint> {
    if (!this.contract.DEFAULT_COLLATERAL_MULTIPLIER) {
      throw new Error('DEFAULT_COLLATERAL_MULTIPLIER not available on contract');
    }

    return BigInt(await this.contract.DEFAULT_COLLATERAL_MULTIPLIER());
  }

  /**
   * Calculate collateral amount for an output
   * @param output Mandate output
   * @returns Promise with collateral amount
   */
  async calculateCollateralAmount(output: MandateOutput): Promise<bigint> {
    const multiplier = await this.getCollateralMultiplier();
    return BigInt(output.amount) * multiplier;
  }

  // Helper Methods

  /**
   * Get output hash for verification
   * @param orderId Order identifier
   * @param output Mandate output
   * @returns Promise with output hash
   */
  private async getOutputHash(orderId: string, output: MandateOutput): Promise<string> {
    // This would typically encode the fill description
    // For now, return the output identifier as a placeholder
    return await this.outputIdentifier(output);
  }

  // Event Listeners

  /**
   * Listen for OutputClaimed events
   * @param callback Event callback function
   * @returns Cleanup function
   */
  onOutputClaimed(callback: (orderId: string, outputId: string) => void): () => void {
    if (!this.contract.on) {
      throw new Error('Event listening not supported');
    }

    const eventHandler = (orderId: string, outputId: string) => {
      callback(orderId, outputId);
    };

    this.contract.on('OutputClaimed', eventHandler);

    return () => {
      this.contract.off('OutputClaimed', eventHandler);
    };
  }

  /**
   * Listen for OutputDisputed events
   * @param callback Event callback function
   * @returns Cleanup function
   */
  onOutputDisputed(callback: (orderId: string, outputId: string) => void): () => void {
    if (!this.contract.on) {
      throw new Error('Event listening not supported');
    }

    const eventHandler = (orderId: string, outputId: string) => {
      callback(orderId, outputId);
    };

    this.contract.on('OutputDisputed', eventHandler);

    return () => {
      this.contract.off('OutputDisputed', eventHandler);
    };
  }

  /**
   * Listen for OutputFilled events
   * @param callback Event callback function
   * @returns Cleanup function
   */
  onOutputFilled(callback: (orderId: string, solver: string, timestamp: number, output: MandateOutput) => void): () => void {
    if (!this.contract.on) {
      throw new Error('Event listening not supported');
    }

    const eventHandler = (orderId: string, solver: string, timestamp: number, output: MandateOutput) => {
      callback(orderId, solver, Number(timestamp), output);
    };

    this.contract.on('OutputFilled', eventHandler);

    return () => {
      this.contract.off('OutputFilled', eventHandler);
    };
  }

  /**
   * Listen for OutputOptimisticallyVerified events
   * @param callback Event callback function
   * @returns Cleanup function
   */
  onOutputOptimisticallyVerified(callback: (orderId: string, outputId: string) => void): () => void {
    if (!this.contract.on) {
      throw new Error('Event listening not supported');
    }

    const eventHandler = (orderId: string, outputId: string) => {
      callback(orderId, outputId);
    };

    this.contract.on('OutputOptimisticallyVerified', eventHandler);

    return () => {
      this.contract.off('OutputOptimisticallyVerified', eventHandler);
    };
  }
} 