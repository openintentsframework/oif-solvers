// StandardOrder.ts - Complete TypeScript implementation of Solidity StandardOrder struct 
// Task 9: Implement StandardOrder Model with validation, serialization, and hash calculation

import { ethers } from 'ethers';
import { MandateOutput } from './MandateOutput';

/**
 * StandardOrder structure matching the Solidity struct exactly
 */
export interface StandardOrder {
  user: string;
  nonce: bigint;
  originChainId: bigint;
  expires: number;       // uint32
  fillDeadline: number;  // uint32
  localOracle: string;
  inputs: [bigint, bigint][];    // uint256[2][] - [tokenId, amount] pairs
  outputs: MandateOutput[];
}

/**
 * JSON-serializable version of StandardOrder (for automation scripts)
 */
export interface StandardOrderJSON {
  user: string;
  nonce: string;
  originChainId: string;
  expires: number;
  fillDeadline: number;
  localOracle: string;
  inputs: [string, string][];    // Serialized as strings
  outputs: MandateOutput[];      // MandateOutput already JSON-compatible
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Order input structure for convenience
 */
export interface OrderInput {
  tokenId: bigint;
  amount: bigint;
}

/**
 * StandardOrder class with validation, serialization, and hash calculation
 */
export class StandardOrderModel {
  public readonly order: StandardOrder;

  constructor(order: StandardOrder) {
    this.order = order;
  }

  /**
   * Validates the StandardOrder structure
   */
  validate(): ValidationResult {
    const errors: string[] = [];

    // Validate user address
    if (!ethers.isAddress(this.order.user)) {
      errors.push('Invalid user address');
    }

    // Validate nonce (must be non-negative)
    if (this.order.nonce < 0n) {
      errors.push('Nonce must be non-negative');
    }

    // Validate chain ID (must be positive)
    if (this.order.originChainId <= 0n) {
      errors.push('Origin chain ID must be positive');
    }

    // Validate timestamps (expires must be after fillDeadline)
    if (this.order.expires <= this.order.fillDeadline) {
      errors.push('Expires timestamp must be after fill deadline');
    }

    // Validate future timestamps
    const currentTime = Math.floor(Date.now() / 1000);
    if (this.order.fillDeadline <= currentTime) {
      errors.push('Fill deadline must be in the future');
    }

    // Validate localOracle address
    if (!ethers.isAddress(this.order.localOracle)) {
      errors.push('Invalid local oracle address');
    }

    // Validate inputs array
    if (this.order.inputs.length === 0) {
      errors.push('At least one input is required');
    }

    this.order.inputs.forEach((input, index) => {
      if (input.length !== 2) {
        errors.push(`Input ${index} must have exactly 2 elements [tokenId, amount]`);
      }
      if (input[0] < 0n) {
        errors.push(`Input ${index} tokenId must be non-negative`);
      }
      if (input[1] <= 0n) {
        errors.push(`Input ${index} amount must be positive`);
      }
    });

    // Validate outputs array
    if (this.order.outputs.length === 0) {
      errors.push('At least one output is required');
    }

    this.order.outputs.forEach((output, index) => {
      if (output.chainId <= 0) {
        errors.push(`Output ${index} chain ID must be positive`);
      }
      
      // Validate amount as string (MandateOutput uses string type)
      try {
        const amount = BigInt(output.amount);
        if (amount <= 0n) {
          errors.push(`Output ${index} amount must be positive`);
        }
      } catch {
        errors.push(`Output ${index} amount must be a valid number string`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert to JSON-serializable format (for automation scripts)
   */
  toJSON(): StandardOrderJSON {
    return {
      user: this.order.user,
      nonce: this.order.nonce.toString(),
      originChainId: this.order.originChainId.toString(),
      expires: this.order.expires,
      fillDeadline: this.order.fillDeadline,
      localOracle: this.order.localOracle,
      inputs: this.order.inputs.map(input => [input[0].toString(), input[1].toString()]),
      outputs: this.order.outputs
    };
  }

  /**
   * Create from JSON format (from automation scripts)
   */
  static fromJSON(json: StandardOrderJSON): StandardOrderModel {
    const order: StandardOrder = {
      user: json.user,
      nonce: BigInt(json.nonce),
      originChainId: BigInt(json.originChainId),
      expires: json.expires,
      fillDeadline: json.fillDeadline,
      localOracle: json.localOracle,
      inputs: json.inputs.map(input => [BigInt(input[0]), BigInt(input[1])]),
      outputs: json.outputs
    };

    return new StandardOrderModel(order);
  }

  /**
   * Calculate order identifier hash (matches Solidity implementation)
   * Based on StandardOrderType.orderIdentifier in Solidity
   */
  calculateOrderHash(contractAddress: string, chainId: bigint): string {
    // Solidity implementation:
    // keccak256(abi.encodePacked(
    //   block.chainid,
    //   address(this),
    //   order.user,
    //   order.nonce,
    //   order.expires,
    //   order.fillDeadline,
    //   order.localOracle,
    //   order.inputs,
    //   abi.encode(order.outputs)
    // ))

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    
    // Encode outputs using ABI encoding (to match Solidity abi.encode)
    const encodedOutputs = abiCoder.encode(
      ['tuple(bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes,bytes)[]'],
      [this.order.outputs.map(output => [
        output.remoteOracle,
        output.remoteFiller,
        output.chainId,
        output.token,
        output.amount,
        output.recipient,
        output.remoteCall,
        output.fulfillmentContext
      ])]
    );

    // Pack all data (to match Solidity abi.encodePacked)
    const packed = ethers.solidityPacked(
      ['uint256', 'address', 'address', 'uint256', 'uint32', 'uint32', 'address', 'uint256[2][]', 'bytes'],
      [
        chainId,
        contractAddress,
        this.order.user,
        this.order.nonce,
        this.order.expires,
        this.order.fillDeadline,
        this.order.localOracle,
        this.order.inputs,
        encodedOutputs
      ]
    );

    return ethers.keccak256(packed);
  }

  /**
   * Calculate witness hash for compact signatures (matches Solidity implementation)
   * Based on StandardOrderType.witnessHash in Solidity
   */
  calculateWitnessHash(): string {
    // Solidity constants
    const MANDATE_OUTPUT_TYPE_HASH = ethers.keccak256(
      ethers.toUtf8Bytes(
        "MandateOutput(bytes32 remoteOracle,bytes32 remoteFiller,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes remoteCall,bytes fulfillmentContext)"
      )
    );

    const CATALYST_WITNESS_TYPE_HASH = ethers.keccak256(
      ethers.toUtf8Bytes(
        "Mandate(uint32 fillDeadline,address localOracle,MandateOutput[] outputs)MandateOutput(bytes32 remoteOracle,bytes32 remoteFiller,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes remoteCall,bytes fulfillmentContext)"
      )
    );

    // Hash outputs array
    const outputHashes = this.order.outputs.map(output => {
      return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'uint256', 'bytes32', 'bytes32', 'bytes32'],
          [
            MANDATE_OUTPUT_TYPE_HASH,
            output.remoteOracle,
            output.remoteFiller,
            output.chainId,
            output.token,
            output.amount,
            output.recipient,
            ethers.keccak256(output.remoteCall),
            ethers.keccak256(output.fulfillmentContext)
          ]
        )
      );
    });

    const outputsHash = ethers.keccak256(ethers.solidityPacked(['bytes32[]'], [outputHashes]));

    // Calculate witness hash
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint32', 'address', 'bytes32'],
        [
          CATALYST_WITNESS_TYPE_HASH,
          this.order.fillDeadline,
          this.order.localOracle,
          outputsHash
        ]
      )
    );
  }

  /**
   * Serialize order to bytes (for storage/transmission)
   */
  serialize(): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    
    return abiCoder.encode(
      ['tuple(address,uint256,uint256,uint32,uint32,address,uint256[2][],tuple(bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes,bytes)[])'],
      [[
        this.order.user,
        this.order.nonce,
        this.order.originChainId,
        this.order.expires,
        this.order.fillDeadline,
        this.order.localOracle,
        this.order.inputs,
        this.order.outputs.map(output => [
          output.remoteOracle,
          output.remoteFiller,
          output.chainId,
          output.token,
          output.amount,
          output.recipient,
          output.remoteCall,
          output.fulfillmentContext
        ])
      ]]
    );
  }

  /**
   * Deserialize order from bytes
   */
  static deserialize(data: string): StandardOrderModel {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    
    const decoded = abiCoder.decode(
      ['tuple(address,uint256,uint256,uint32,uint32,address,uint256[2][],tuple(bytes32,bytes32,uint256,bytes32,uint256,bytes32,bytes,bytes)[])'],
      data
    )[0];

    const order: StandardOrder = {
      user: decoded[0],
      nonce: decoded[1],
      originChainId: decoded[2],
      expires: decoded[3],
      fillDeadline: decoded[4],
      localOracle: decoded[5],
      inputs: decoded[6],
      outputs: decoded[7].map((output: any) => ({
        remoteOracle: output[0],
        remoteFiller: output[1],
        chainId: output[2],
        token: output[3],
        amount: output[4],
        recipient: output[5],
        remoteCall: output[6],
        fulfillmentContext: output[7]
      }))
    };

    return new StandardOrderModel(order);
  }

  /**
   * Create a StandardOrder instance for automation scripts
   * Matches the format used in Step1_CreateOrder.s.sol
   */
  static createForAutomation(params: {
    user: string;
    nonce: bigint;
    originChainId: bigint;
    expires?: number;
    fillDeadline?: number;
    localOracle: string;
    inputs: OrderInput[];
    outputs: MandateOutput[];
  }): StandardOrderModel {
    const currentTime = Math.floor(Date.now() / 1000);
    
    const order: StandardOrder = {
      user: params.user,
      nonce: params.nonce,
      originChainId: params.originChainId,
      expires: params.expires || (2**32 - 1), // Max uint32 if not specified
      fillDeadline: params.fillDeadline || (2**32 - 1), // Max uint32 if not specified
      localOracle: params.localOracle,
      inputs: params.inputs.map(input => [input.tokenId, input.amount]),
      outputs: params.outputs
    };

    return new StandardOrderModel(order);
  }

  /**
   * Get inputs as convenient OrderInput array
   */
  getInputs(): OrderInput[] {
    return this.order.inputs.map(input => ({
      tokenId: input[0],
      amount: input[1]
    }));
  }

  /**
   * Get a summary of the order for logging
   */
  getSummary(): string {
    return `StandardOrder { user: ${this.order.user}, nonce: ${this.order.nonce}, chainId: ${this.order.originChainId}, inputs: ${this.order.inputs.length}, outputs: ${this.order.outputs.length} }`;
  }
}