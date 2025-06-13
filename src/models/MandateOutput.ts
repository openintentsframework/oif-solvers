// MandateOutput.ts - Complete TypeScript implementation of Solidity MandateOutput struct
// Task 10: Implement MandateOutput Model with validation and encoding

import { ethers } from 'ethers';

/**
 * MandateOutput structure matching the Solidity struct exactly
 */
export interface MandateOutput {
  remoteOracle: string;    // bytes32 - oracle contract on destination chain
  remoteFiller: string;    // bytes32 - filler contract on destination chain  
  chainId: number;         // uint256 - destination chain ID
  token: string;           // bytes32 - token address on destination chain
  amount: string;          // uint256 - amount to be sent (as string for JSON compatibility)
  recipient: string;       // bytes32 - address to receive the output tokens
  remoteCall: string;      // bytes - additional data for remote execution
  fulfillmentContext: string; // bytes - non-generic filler behavior data
}

/**
 * Validation result for MandateOutput
 */
export interface MandateOutputValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Encoded MandateOutput for cross-chain communication
 */
export interface EncodedMandateOutput {
  encoded: string;
  hash: string;
}

/**
 * MandateOutput class with validation, encoding, and utilities
 */
export class MandateOutputModel {
  public readonly output: MandateOutput;

  constructor(output: MandateOutput) {
    this.output = output;
  }

  /**
   * Validates the MandateOutput structure
   */
  validate(): MandateOutputValidationResult {
    const errors: string[] = [];

    // Validate remoteOracle (must be valid bytes32)
    if (!this.isValidBytes32(this.output.remoteOracle)) {
      errors.push('Remote oracle must be valid bytes32 format');
    }

    // Validate remoteFiller (must be valid bytes32)
    if (!this.isValidBytes32(this.output.remoteFiller)) {
      errors.push('Remote filler must be valid bytes32 format');
    }

    // Validate chainId (must be positive)
    if (this.output.chainId <= 0) {
      errors.push('Chain ID must be positive');
    }

    // Validate token (must be valid bytes32)
    if (!this.isValidBytes32(this.output.token)) {
      errors.push('Token must be valid bytes32 format');
    }

    // Validate amount (must be valid number string)
    try {
      const amount = BigInt(this.output.amount);
      if (amount <= 0n) {
        errors.push('Amount must be positive');
      }
    } catch {
      errors.push('Amount must be a valid number string');
    }

    // Validate recipient (must be valid bytes32)
    if (!this.isValidBytes32(this.output.recipient)) {
      errors.push('Recipient must be valid bytes32 format');
    }

    // Validate remoteCall (must be valid hex)
    if (!this.isValidHex(this.output.remoteCall)) {
      errors.push('Remote call must be valid hex string');
    }

    // Validate fulfillmentContext (must be valid hex)
    if (!this.isValidHex(this.output.fulfillmentContext)) {
      errors.push('Fulfillment context must be valid hex string');
    }

    // Check remoteCall length constraint (max 65535 bytes)
    const remoteCallBytes = ethers.getBytes(this.output.remoteCall);
    if (remoteCallBytes.length > 65535) {
      errors.push('Remote call data exceeds maximum length of 65535 bytes');
    }

    // Check fulfillmentContext length constraint (max 65535 bytes)
    const fulfillmentContextBytes = ethers.getBytes(this.output.fulfillmentContext);
    if (fulfillmentContextBytes.length > 65535) {
      errors.push('Fulfillment context data exceeds maximum length of 65535 bytes');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Encode MandateOutput for cross-chain communication
   * Matches the Solidity MandateOutputEncodingLib.encodeMandateOutput
   */
  encode(): EncodedMandateOutput {
    const remoteCallBytes = ethers.getBytes(this.output.remoteCall);
    const fulfillmentContextBytes = ethers.getBytes(this.output.fulfillmentContext);

    // Encode following Solidity structure:
    // abi.encodePacked(
    //   remoteOracle,           // 32 bytes
    //   remoteFiller,           // 32 bytes  
    //   chainId,                // 32 bytes
    //   token,                  // 32 bytes
    //   amount,                 // 32 bytes
    //   recipient,              // 32 bytes
    //   uint16(remoteCall.length),     // 2 bytes
    //   remoteCall,             // variable
    //   uint16(fulfillmentContext.length), // 2 bytes
    //   fulfillmentContext      // variable
    // )

    const encoded = ethers.solidityPacked(
      ['bytes32', 'bytes32', 'uint256', 'bytes32', 'uint256', 'bytes32', 'uint16', 'bytes', 'uint16', 'bytes'],
      [
        this.output.remoteOracle,
        this.output.remoteFiller,
        this.output.chainId,
        this.output.token,
        this.output.amount,
        this.output.recipient,
        remoteCallBytes.length,
        this.output.remoteCall,
        fulfillmentContextBytes.length,
        this.output.fulfillmentContext
      ]
    );

    const hash = ethers.keccak256(encoded);

    return { encoded, hash };
  }

  /**
   * Calculate the EIP-712 style hash for this MandateOutput
   * Matches the Solidity MandateOutputType.hashOutput
   */
  calculateTypeHash(): string {
    const MANDATE_OUTPUT_TYPE_HASH = ethers.keccak256(
      ethers.toUtf8Bytes(
        "MandateOutput(bytes32 remoteOracle,bytes32 remoteFiller,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes remoteCall,bytes fulfillmentContext)"
      )
    );

    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'uint256', 'bytes32', 'bytes32', 'bytes32'],
        [
          MANDATE_OUTPUT_TYPE_HASH,
          this.output.remoteOracle,
          this.output.remoteFiller,
          this.output.chainId,
          this.output.token,
          this.output.amount,
          this.output.recipient,
          ethers.keccak256(this.output.remoteCall),
          ethers.keccak256(this.output.fulfillmentContext)
        ]
      )
    );
  }

  /**
   * Create MandateOutput from address strings (convenience method)
   */
  static fromAddresses(params: {
    remoteOracle: string;
    remoteFiller: string;
    chainId: number;
    token: string;
    amount: string;
    recipient: string;
    remoteCall?: string;
    fulfillmentContext?: string;
  }): MandateOutputModel {
    const output: MandateOutput = {
      remoteOracle: ethers.zeroPadValue(params.remoteOracle, 32),
      remoteFiller: ethers.zeroPadValue(params.remoteFiller, 32),
      chainId: params.chainId,
      token: ethers.zeroPadValue(params.token, 32),
      amount: params.amount,
      recipient: ethers.zeroPadValue(params.recipient, 32),
      remoteCall: params.remoteCall || '0x',
      fulfillmentContext: params.fulfillmentContext || '0x'
    };

    return new MandateOutputModel(output);
  }

  /**
   * Create MandateOutput for automation script compatibility
   */
  static createForAutomation(params: {
    remoteOracleAddress: string;
    remoteFillerAddress: string;
    destinationChainId: number;
    tokenAddress: string;
    outputAmount: string;
    recipientAddress: string;
    remoteCallData?: string;
    fulfillmentData?: string;
  }): MandateOutputModel {
    return MandateOutputModel.fromAddresses({
      remoteOracle: params.remoteOracleAddress,
      remoteFiller: params.remoteFillerAddress,
      chainId: params.destinationChainId,
      token: params.tokenAddress,
      amount: params.outputAmount,
      recipient: params.recipientAddress,
      remoteCall: params.remoteCallData,
      fulfillmentContext: params.fulfillmentData
    });
  }

  /**
   * Get the destination chain ID
   */
  getDestinationChainId(): number {
    return this.output.chainId;
  }

  /**
   * Get the amount as BigInt
   */
  getAmountBigInt(): bigint {
    return BigInt(this.output.amount);
  }

  /**
   * Extract address from bytes32 padded value
   */
  getRemoteOracleAddress(): string {
    return ethers.getAddress(ethers.dataSlice(this.output.remoteOracle, 12));
  }

  getRemoteFillerAddress(): string {
    return ethers.getAddress(ethers.dataSlice(this.output.remoteFiller, 12));
  }

  getTokenAddress(): string {
    return ethers.getAddress(ethers.dataSlice(this.output.token, 12));
  }

  getRecipientAddress(): string {
    return ethers.getAddress(ethers.dataSlice(this.output.recipient, 12));
  }

  /**
   * Check if this output requires remote execution
   */
  hasRemoteCall(): boolean {
    return this.output.remoteCall !== '0x' && this.output.remoteCall.length > 2;
  }

  /**
   * Check if this output has fulfillment context
   */
  hasFulfillmentContext(): boolean {
    return this.output.fulfillmentContext !== '0x' && this.output.fulfillmentContext.length > 2;
  }

  /**
   * Get a summary for logging
   */
  getSummary(): string {
    return `MandateOutput { chain: ${this.output.chainId}, token: ${this.getTokenAddress()}, amount: ${this.output.amount}, recipient: ${this.getRecipientAddress()} }`;
  }

  /**
   * Convert to JSON-compatible format
   */
  toJSON(): MandateOutput {
    return { ...this.output };
  }

  /**
   * Private helper: Check if value is valid bytes32
   */
  private isValidBytes32(value: string): boolean {
    try {
      return ethers.isHexString(value, 32);
    } catch {
      return false;
    }
  }

  /**
   * Private helper: Check if value is valid hex
   */
  private isValidHex(value: string): boolean {
    try {
      return ethers.isHexString(value);
    } catch {
      return false;
    }
  }
}

/**
 * Utility function to hash multiple MandateOutputs
 * Matches Solidity MandateOutputType.hashOutputs
 */
export function hashMandateOutputs(outputs: MandateOutput[]): string {
  const outputHashes = outputs.map(output => {
    const model = new MandateOutputModel(output);
    return model.calculateTypeHash();
  });

  return ethers.keccak256(ethers.solidityPacked(['bytes32[]'], [outputHashes]));
} 