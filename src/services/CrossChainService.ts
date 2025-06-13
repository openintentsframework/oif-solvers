// CrossChainService.ts - Simplified Cross-Chain Fill Operations
// Focuses on executing fills on destination chains while keeping core functionality

import { ethers } from 'ethers';
import { ContractFactory } from '../contracts/ContractFactory';
import { StandardOrder } from '../models/StandardOrder';

export interface FillResult {
  success: boolean;
  txHash?: string;
  gasCost?: bigint;
  error?: string;
}

export interface CrossChainConfig {
  gasMultiplier: number; // Gas limit multiplier (e.g., 1.2 for 20% buffer)
  maxGasPrice: bigint; // Maximum gas price to pay
  retryAttempts: number; // Number of retry attempts for failed fills
  retryDelay: number; // Delay between retries (milliseconds)
  minFillDeadlineBuffer: number; // Minimum time before deadline to attempt fill (seconds)
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  totalCost: bigint;
  isAffordable: boolean;
}

/**
 * Simplified Cross-Chain Service for Fill Operations
 * Keeps core functionality while removing complex orchestration
 */
export class CrossChainService {
  private config: CrossChainConfig;

  constructor(
    private contractFactory: ContractFactory,
    config: Partial<CrossChainConfig> = {}
  ) {
    this.config = {
      gasMultiplier: 1.2,
      maxGasPrice: BigInt('200000000000'), // 200 gwei
      retryAttempts: 3,
      retryDelay: 5000, // 5 seconds
      minFillDeadlineBuffer: 60, // 1 minute
      ...config
    };

    console.log('CrossChainService initialized (simplified but functional)');
  }

  /**
   * Execute fill operation on destination chain
   * Keeps the core functionality from the original executeFill method
   */
  async executeFill(orderId: string, order?: StandardOrder): Promise<FillResult> {
    if (!order) {
      return {
        success: false,
        error: 'Order data is required for fill execution'
      };
    }

    console.log(`💰 Executing fill for order ${orderId}`);

    let attempt = 0;
    while (attempt < this.config.retryAttempts) {
      try {
        attempt++;
        console.log(`  🔄 Fill attempt ${attempt}/${this.config.retryAttempts} for order ${orderId}`);

        // Pre-fill validation
        const validation = await this.validateFillPreconditions(order);
        if (!validation.valid) {
          throw new Error(validation.error);
        }

        // Execute the actual fill transaction
        const fillResult = await this.executeDestinationFill(order, orderId);
        
        if (fillResult.success) {
          console.log(`  ✅ Fill successful for order ${orderId}, tx: ${fillResult.txHash}`);
          return fillResult;
        } else {
          throw new Error(fillResult.error || 'Fill transaction failed');
        }

      } catch (error) {
        console.error(`  ❌ Fill attempt ${attempt} failed for order ${orderId}:`, error);

        if (attempt < this.config.retryAttempts) {
          console.log(`  ⏳ Retrying in ${this.config.retryDelay}ms...`);
          await this.delay(this.config.retryDelay);
        }
      }
    }

    return {
      success: false,
      error: `All ${this.config.retryAttempts} fill attempts failed`
    };
  }

  /**
   * Validate fill preconditions (simplified from original pre-fill checks)
   */
  private async validateFillPreconditions(order: StandardOrder): Promise<{ valid: boolean; error?: string }> {
    try {
      // Check fill deadline
      const now = Math.floor(Date.now() / 1000);
      const timeUntilDeadline = order.fillDeadline - now;

      if (timeUntilDeadline <= this.config.minFillDeadlineBuffer) {
        return {
          valid: false,
          error: `Fill deadline too close: ${timeUntilDeadline}s remaining, minimum ${this.config.minFillDeadlineBuffer}s required`
        };
      }

      // Check destination output exists
      const destinationOutput = order.outputs[0];
      if (!destinationOutput) {
        return {
          valid: false,
          error: 'Order has no destination output'
        };
      }

      // Basic amount validation
      if (!destinationOutput.amount || Number(destinationOutput.amount) <= 0) {
        return {
          valid: false,
          error: `Invalid output amount: ${destinationOutput.amount}`
        };
      }

      return { valid: true };

    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${(error as Error).message}`
      };
    }
  }

  /**
   * Execute the actual fill transaction on destination chain
   * Core functionality from original executeFill method
   */
  private async executeDestinationFill(order: StandardOrder, orderId: string): Promise<FillResult> {
    try {
      const destinationOutput = order.outputs[0];
      if (!destinationOutput) {
        throw new Error('No destination output found');
      }

      const destinationChain = destinationOutput.chainId;

      // Get CoinFiller contract
      const coinFillerContract = this.contractFactory.getContract(
        'CoinFiller',
        destinationChain
      );

      // Get solver wallet for destination chain
      const solverWallet = await this.getSolverWallet(destinationChain);
      const coinFillerWithSigner = coinFillerContract.connect(solverWallet);

      // Estimate gas for the fill transaction
      const gasEstimate = await this.estimateFillGas(order, destinationChain);
      if (!gasEstimate.isAffordable) {
        throw new Error(`Fill gas cost ${gasEstimate.totalCost.toString()} exceeds maximum ${this.config.maxGasPrice.toString()}`);
      }

      console.log(`    🔄 Executing CoinFiller.fill() for order ${orderId}...`, {
        outputAmount: destinationOutput.amount,
        recipient: destinationOutput.recipient,
        chainId: destinationChain,
        gasLimit: gasEstimate.gasLimit.toString()
      });

      // Create MandateOutput structure exactly as in Step2_FinalizeOrder.s.sol
      const mandateOutput = {
        remoteOracle: ethers.zeroPadValue(destinationOutput.remoteOracle, 32),
        remoteFiller: ethers.zeroPadValue(destinationOutput.remoteFiller, 32),
        chainId: destinationChain,
        token: ethers.zeroPadValue(destinationOutput.token, 32),
        amount: destinationOutput.amount,
        recipient: ethers.zeroPadValue(destinationOutput.recipient, 32),
        remoteCall: destinationOutput.remoteCall || '0x',
        fulfillmentContext: destinationOutput.fulfillmentContext || '0x'
      };

      // Solver identifier as bytes32 (matching Step2 script) - ensure proper checksum format first
      const checksummedAddress = ethers.getAddress(solverWallet.address); // Ensure proper checksum
      const solverIdentifier = ethers.toBeHex(checksummedAddress, 32);

      // Convert orderId string to bytes32
      const orderIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(orderId));

      // Execute fill transaction with CORRECT parameters matching Step2_FillOrder.s.sol:
      // coinFiller.fill(type(uint32).max, orderId, output, solverIdentifier);
      
      // Debug: Log the parameters being passed
      console.log('      🔍 Fill parameters:', {
        fillDeadline: 4294967295,
        orderId: orderIdBytes32,
        output: mandateOutput,
        proposedSolver: solverIdentifier
      });

      // Call the fill function - cast to any to avoid TypeScript interface issues
      const tx = await (coinFillerWithSigner as any).fill(
        4294967295,      // type(uint32).max - fillDeadline
        orderIdBytes32,  // bytes32 orderId (converted from string)
        mandateOutput,   // MandateOutput struct
        solverIdentifier, // bytes32 solverIdentifier
        {
          gasLimit: gasEstimate.gasLimit,
          gasPrice: gasEstimate.gasPrice
        }
      );

      console.log(`    📡 Fill transaction submitted: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error(`Fill transaction failed: ${tx.hash}`);
      }

      const actualGasPrice = receipt.gasPrice || gasEstimate.gasPrice;
      const gasCost = BigInt(receipt.gasUsed) * BigInt(actualGasPrice);

      console.log(`    ✅ Fill completed successfully: ${tx.hash}`, {
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        gasCost: gasCost.toString()
      });

      return {
        success: true,
        txHash: tx.hash,
        gasCost
      };

    } catch (error) {
      console.error(`    ❌ Fill execution failed:`, error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Estimate gas for fill operation (simplified from original)
   */
  private async estimateFillGas(order: StandardOrder, chainId: number): Promise<GasEstimate> {
    try {
      const provider = this.contractFactory.getProvider(chainId);
      
      // Get current gas price
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt('50000000000'); // 50 gwei fallback
      const adjustedGasPrice = gasPrice > this.config.maxGasPrice ? this.config.maxGasPrice : gasPrice;

      // Estimate gas limit for fill operation
      const baseGasLimit = BigInt(300000); // Conservative estimate for fill operation
      const gasLimit = BigInt(Math.floor(Number(baseGasLimit) * this.config.gasMultiplier));

      const totalCost = gasLimit * adjustedGasPrice;

      return {
        gasLimit,
        gasPrice: adjustedGasPrice,
        totalCost,
        isAffordable: adjustedGasPrice <= this.config.maxGasPrice
      };

    } catch (error) {
      console.error('Error estimating fill gas:', error);
      // Return conservative fallback values
      return {
        gasLimit: BigInt(400000),
        gasPrice: this.config.maxGasPrice,
        totalCost: BigInt(400000) * this.config.maxGasPrice,
        isAffordable: true
      };
    }
  }

  /**
   * Get solver wallet for specific chain (simplified)
   */
  private async getSolverWallet(chainId: number): Promise<ethers.Wallet> {
    try {
      const provider = this.contractFactory.getProvider(chainId);
      
      // For MVP, use a simple private key approach
      // In production, this would use proper key management
      const privateKey = process.env.SOLVER_PRIVATE_KEY || '0x' + '1'.repeat(64); // Fallback for testing
      
      const wallet = new ethers.Wallet(privateKey, provider);
      return wallet;

    } catch (error) {
      console.error(`Error creating solver wallet for chain ${chainId}:`, error);
      throw new Error(`Failed to create solver wallet: ${(error as Error).message}`);
    }
  }

  /**
   * Get service configuration
   */
  getConfig(): CrossChainConfig {
    return { ...this.config };
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<CrossChainConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('CrossChainService config updated:', newConfig);
  }

  /**
   * Check if service can execute fills (basic health check)
   */
  async canExecuteFills(): Promise<boolean> {
    try {
      // Basic check - ensure we can get providers for common chains
      const testChainIds = [1, 10, 42161]; // Ethereum, Optimism, Arbitrum
      
      for (const chainId of testChainIds) {
        try {
          const provider = this.contractFactory.getProvider(chainId);
          if (!provider) return false;
        } catch {
          // If we can't get provider for a chain, that's okay for now
          continue;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }

  /**
   * Helper method for delays
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 