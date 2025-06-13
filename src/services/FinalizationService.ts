// FinalizationService.ts - Simplified Order Finalization (Step3 Equivalent)
// Implements actual SettlerCompact.finalise() calls based on Step3_FinalizeOrder.s.sol

import { ethers } from 'ethers';
import { ContractFactory } from '../contracts/ContractFactory';
import { StandardOrder } from '../models/StandardOrder';
import { OrderStorage } from '../storage/OrderStorage';

export interface FinalizationResult {
  success: boolean;
  txHash?: string;
  gasCost?: bigint;
  tokensReclaimed?: bigint;
  error?: string;
}

export interface FinalizationConfig {
  gasMultiplier: number; // Gas limit multiplier for safety buffer
  maxGasPrice: bigint; // Maximum gas price willing to pay
  retryAttempts: number; // Number of retry attempts for failed finalization
  retryDelay: number; // Delay between retry attempts (milliseconds)
}

/**
 * Simplified Finalization Service for Origin Chain Settlement
 * Equivalent to Step3_FinalizeOrder.s.sol functionality
 * Implements actual SettlerCompact.finalise() contract call
 */
export class FinalizationService {
  private config: FinalizationConfig;

  constructor(
    private contractFactory: ContractFactory,
    private orderStorage: OrderStorage,
    config: Partial<FinalizationConfig> = {}
  ) {
    this.config = {
      gasMultiplier: 1.3,
      maxGasPrice: BigInt('300000000000'), // 300 gwei
      retryAttempts: 3,
      retryDelay: 5000, // 5 seconds
      ...config
    };

    console.log('FinalizationService initialized (with actual SettlerCompact.finalise() calls)');
  }

  /**
   * Finalize order on origin chain
   * This implements the exact logic from Step3_FinalizeOrder.s.sol
   */
  async finalizeOrder(orderId: string, order?: StandardOrder): Promise<FinalizationResult> {
    // If order is not provided, try to get it from storage
    if (!order) {
      const storedOrder = this.orderStorage.getOrder(orderId);
      if (!storedOrder) {
        return {
          success: false,
          error: 'Order not found in storage'
        };
      }
      order = storedOrder.order;
    }

    console.log(`🏁 Finalizing order ${orderId} on origin chain`);

    let attempt = 0;
    while (attempt < this.config.retryAttempts) {
      try {
        attempt++;
        console.log(`  🔄 Finalization attempt ${attempt}/${this.config.retryAttempts} for order ${orderId}`);

        // Execute the actual finalization
        const result = await this.executeSettlerCompactFinalize(order, orderId);
        
        if (result.success) {
          console.log(`  ✅ Finalization successful for order ${orderId}, tx: ${result.txHash}`);
          return result;
        } else {
          throw new Error(result.error || 'Finalization transaction failed');
        }

      } catch (error) {
        console.error(`  ❌ Finalization attempt ${attempt} failed for order ${orderId}:`, error);

        if (attempt < this.config.retryAttempts) {
          console.log(`  ⏳ Retrying in ${this.config.retryDelay}ms...`);
          await this.delay(this.config.retryDelay);
        }
      }
    }

    return {
      success: false,
      error: `All ${this.config.retryAttempts} finalization attempts failed`
    };
  }

  /**
   * Execute SettlerCompact.finalise() with exact Step3 logic
   * Based on Step3_FinalizeOrder.s.sol implementation
   */
  private async executeSettlerCompactFinalize(order: StandardOrder, orderId: string): Promise<FinalizationResult> {
    try {
      const originChain = Number(order.originChainId);

      // Get the stored order to access the real signature
      const storedOrder = this.orderStorage.getOrder(orderId);
      if (!storedOrder) {
        throw new Error('Order not found in storage - cannot retrieve signature');
      }
      
      // Get SettlerCompact contract address
      const settlerContract = this.contractFactory.getContract(
        'SettlerCompact',
        originChain
      );

      // Get solver wallet for origin chain
      const solverWallet = await this.getSolverWallet(originChain);
      
      const settlerWithSigner = settlerContract.connect(solverWallet);

      // Estimate gas for the finalization transaction
      const gasEstimate = await this.estimateFinalizationGas(order, originChain);
      if (!gasEstimate.isAffordable) {
        throw new Error(`Finalization gas cost ${gasEstimate.totalCost.toString()} exceeds maximum ${this.config.maxGasPrice.toString()}`);
      }

      // CRITICAL: Use the exact same address format for both caller and solvers array
      // The issue is ethers.toBeHex() normalizes to lowercase, but wallet address is mixed case
      // We need to ensure the destination matches the actual transaction sender exactly
      const solverAddress = solverWallet.address; // Use wallet's address format (mixed case)
      
      // Convert to bytes32 manually to preserve the exact case from the wallet
      // Remove 0x, pad with zeros to 64 chars (32 bytes), then add 0x back
      const addressHex = solverAddress.slice(2); // Remove 0x
      const paddedAddress = '0x' + '0'.repeat(24) + addressHex; // Pad to 32 bytes, preserving case
      const destination = paddedAddress; // Send tokens to solver
      
      // Create timestamp for finalization
      const timestamps = [Math.floor(Date.now() / 1000)];
      
      // Use the REAL signature from the stored order
      console.log(`  🔐 Using real signature from stored order`);
      const sponsorSig = storedOrder.signature; // Real signature from order submission
      const allocatorSig = '0x'; // Empty for AlwaysOKAllocator
      const signatures = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'bytes'], 
        [sponsorSig, allocatorSig]
      );

      // Solver identifier as bytes32 - use the same manual padding to preserve case
      const solverIdentifier = paddedAddress; // Same as destination to ensure exact match
      const solvers = [solverIdentifier];

      // Prepare the order with all required fields (convert addresses to bytes32 and add missing fields)
      // Also ensure all numeric values are properly formatted as BigInt
      const contractOrder = {
        ...order,
        nonce: BigInt(order.nonce),
        originChainId: BigInt(order.originChainId),
        expires: BigInt(order.expires),
        fillDeadline: BigInt(order.fillDeadline),
        inputs: order.inputs.map(input => {
          // Convert inputs to BigInt carefully, handling very large numbers
          let tokenIdStr: string;
          let amountStr: string;
          
          // Handle token ID conversion
          if (typeof input[0] === 'string') {
            tokenIdStr = input[0];
          } else if (typeof input[0] === 'number') {
            // Use toFixed(0) to avoid scientific notation for large numbers
            tokenIdStr = (input[0] as number).toFixed(0);
          } else {
            // For BigInt or other types, convert to string
            tokenIdStr = String(input[0]);
          }
          
          // Handle amount conversion
          if (typeof input[1] === 'string') {
            amountStr = input[1];
          } else if (typeof input[1] === 'number') {
            amountStr = (input[1] as number).toFixed(0);
          } else {
            amountStr = String(input[1]);
          }
          
          console.log(`🔢 Converting token ID: ${tokenIdStr} (type: ${typeof input[0]})`);
          console.log(`🔢 Converting amount: ${amountStr} (type: ${typeof input[1]})`);
          
          try {
            // Try to convert to BigInt (this handles very large numbers correctly)
            const tokenIdBigInt = BigInt(tokenIdStr);
            const amountBigInt = BigInt(amountStr);
            
            return [tokenIdBigInt, amountBigInt];
          } catch (error) {
            console.error(`Error converting input to BigInt: tokenId=${tokenIdStr}, amount=${amountStr}`, error);
            throw new Error(`Invalid numeric format in order inputs: ${(error as Error).message}`);
          }
        }),
        outputs: order.outputs.map(output => ({
          remoteOracle: ethers.zeroPadValue(output.remoteOracle, 32),      // Convert address to bytes32
          remoteFiller: ethers.zeroPadValue(output.remoteFiller, 32),      // Convert address to bytes32
          chainId: BigInt(output.chainId),                                 // Ensure BigInt
          token: ethers.zeroPadValue(output.token, 32),                    // Convert address to bytes32
          amount: BigInt(output.amount),                                   // Ensure BigInt
          recipient: ethers.zeroPadValue(output.recipient, 32),            // Convert address to bytes32
          remoteCall: output.remoteCall || '0x',                           // Add if missing
          fulfillmentContext: output.fulfillmentContext || '0x'           // Add if missing
        }))
      };

      console.log(`    🔄 Calling SettlerCompact.finalise() for order ${orderId}...`, {
        destination: destination,
        solverAddress: solverAddress,
        walletAddress: solverWallet.address,
        gasLimit: gasEstimate.gasLimit.toString()
      });

      // First, try a static call to get detailed revert reason if it would fail
      try {
        console.log(`    🔍 Testing finalization call statically first...`);
        // Cast to any to avoid TypeScript interface issues with the static call
        await (settlerWithSigner as any).finalise.staticCall(
          contractOrder,  // ← FIX: Use contractOrder instead of order
          signatures,     
          timestamps,
          solvers,
          destination,
          '0x'
        );
        console.log(`    ✅ Static call succeeded, proceeding with actual transaction...`);
      } catch (staticError: any) {
        console.error(`    ❌ Static call failed, this will help debug the issue:`);
        console.error(`    📋 Revert reason:`, staticError.reason || staticError.message);
        console.error(`    📋 Error code:`, staticError.code);
        console.error(`    📋 Error data:`, staticError.data);
        
        // If we have error data, try to decode it
        if (staticError.data) {
          try {
            // Try to decode common error signatures
            const errorInterface = new ethers.Interface([
              'error NotProven()',
              'error InvalidSignature()',
              'error InsufficientBalance()',
              'error OrderExpired()',
              'error InvalidOrderOwner()',
              'error ZeroValue()',
              'error TransferFailed()'
            ]);
            
            const decodedError = errorInterface.parseError(staticError.data);
            console.error(`    📋 Decoded error:`, decodedError?.name, decodedError?.args);
          } catch (decodeError) {
            console.error(`    📋 Could not decode error data`);
          }
        }
        
        // Still throw the error, but now with better debugging info
        throw new Error(`Finalization would fail: ${staticError.reason || staticError.message}`);
      }

      // Execute the actual finalization transaction with better error handling
      try {
        const tx = await (settlerWithSigner as any).finalise(
          contractOrder,  // ← FIX: Use contractOrder instead of order
          signatures,     
          timestamps,
          solvers,
          destination,
          '0x',
          {
            gasLimit: gasEstimate.gasLimit,
            gasPrice: gasEstimate.gasPrice
          }
        );

        console.log(`    📡 SettlerCompact.finalise() transaction submitted: ${tx.hash}`);

        // Wait for confirmation with better error details
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) {
          throw new Error(`Transaction failed: ${tx.hash}, status: ${receipt?.status}`);
        }

        const actualGasPrice = receipt.gasPrice || gasEstimate.gasPrice;
        const gasCost = BigInt(receipt.gasUsed) * BigInt(actualGasPrice);

        console.log(`    ✅ Finalization completed successfully: ${tx.hash}`, {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          gasCost: gasCost.toString()
        });

        return {
          success: true,
          txHash: tx.hash,
          gasCost
        };

      } catch (txError: any) {
        console.error(`    ❌ SettlerCompact.finalise() execution failed:`, txError);
        
        // Try to extract more detailed error information
        let errorMessage = txError.message || 'Unknown transaction error';
        
        if (txError.reason) {
          errorMessage = `${errorMessage} (reason: ${txError.reason})`;
        }
        
        if (txError.code) {
          errorMessage = `${errorMessage} (code: ${txError.code})`;
        }
        
        if (txError.receipt && txError.receipt.gasUsed) {
          errorMessage = `${errorMessage} (gas used: ${txError.receipt.gasUsed})`;
        }

        throw new Error(errorMessage);
      }

    } catch (error) {
      console.error(`    ❌ Finalization execution failed:`, error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Estimate gas for finalization operation
   */
  private async estimateFinalizationGas(order: StandardOrder, chainId: number): Promise<{
    gasLimit: bigint;
    gasPrice: bigint;
    totalCost: bigint;
    isAffordable: boolean;
  }> {
    try {
      const provider = this.contractFactory.getProvider(chainId);
      
      // Get current gas price
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt('100000000000'); // 100 gwei fallback
      const adjustedGasPrice = gasPrice > this.config.maxGasPrice ? this.config.maxGasPrice : gasPrice;

      // Estimate gas limit for SettlerCompact.finalise() operation
      // Based on actual usage, finalise() is more complex than fill()
      const baseGasLimit = BigInt(500000); // Conservative estimate for finalise operation
      const gasLimit = BigInt(Math.floor(Number(baseGasLimit) * this.config.gasMultiplier));

      const totalCost = gasLimit * adjustedGasPrice;

      return {
        gasLimit,
        gasPrice: adjustedGasPrice,
        totalCost,
        isAffordable: adjustedGasPrice <= this.config.maxGasPrice
      };

    } catch (error) {
      console.error('Error estimating finalization gas:', error);
      // Return conservative fallback values
      return {
        gasLimit: BigInt(650000),
        gasPrice: this.config.maxGasPrice,
        totalCost: BigInt(650000) * this.config.maxGasPrice,
        isAffordable: true
      };
    }
  }

  /**
   * Get solver wallet for specific chain
   */
  private async getSolverWallet(chainId: number): Promise<ethers.Wallet> {
    try {
      const provider = this.contractFactory.getProvider(chainId);
      
      // Use private key from environment (same as Step3 script)
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
  getConfig(): FinalizationConfig {
    return { ...this.config };
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<FinalizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('FinalizationService config updated:', newConfig);
  }

  /**
   * Helper method for delays
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 
