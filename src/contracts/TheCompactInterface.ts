// TheCompactInterface.ts - Type-safe interface for TheCompact contract 

import { Contract, ContractTransactionResponse, BigNumberish } from 'ethers';

export interface DepositResult {
  tokenId: bigint;
  transaction: ContractTransactionResponse;
}

export interface CompactClaim {
  sponsor: string;
  nonce: bigint;
  expires: bigint;
  id: bigint;
  amount: bigint;
}

/**
 * Type-safe interface for TheCompact contract operations
 * Handles user token deposits and withdrawals for the OIF protocol
 */
export class TheCompactInterface {
  constructor(private contract: Contract) {}

  /**
   * Deposit ERC20 tokens into TheCompact
   * @param token - ERC20 token address
   * @param allocatorLockTag - Allocator lock identifier
   * @param amount - Amount to deposit
   * @param recipient - Recipient address
   * @returns Promise with tokenId and transaction
   */
  async depositERC20(
    token: string,
    allocatorLockTag: string,
    amount: BigNumberish,
    recipient: string
  ): Promise<DepositResult> {
    if (!this.contract.depositERC20) {
      throw new Error('depositERC20 method not found on contract');
    }
    
    const tx = await this.contract.depositERC20(token, allocatorLockTag, amount, recipient);
    const receipt = await tx.wait();
    
    // Extract tokenId from events (simplified - would need proper event parsing)
    const tokenId = receipt?.logs?.[0]?.topics?.[1] || '0';
    
    return {
      tokenId: BigInt(tokenId),
      transaction: tx
    };
  }

  /**
   * Consume (withdraw) tokens from TheCompact
   * @param claim - Compact claim structure
   * @param signature - Signature for the claim
   * @returns Transaction response
   */
  async consume(claim: CompactClaim, signature: string): Promise<ContractTransactionResponse> {
    if (!this.contract.consume) {
      throw new Error('consume method not found on contract');
    }
    return await this.contract.consume(claim, signature);
  }

  /**
   * Get balance for a specific tokenId
   * @param tokenId - Token identifier
   * @returns Token balance
   */
  async balanceOf(tokenId: BigNumberish): Promise<bigint> {
    if (!this.contract.balanceOf) {
      throw new Error('balanceOf method not found on contract');
    }
    const balance = await this.contract.balanceOf(tokenId);
    return BigInt(balance.toString());
  }

  /**
   * Get domain separator for signature verification
   * @returns Domain separator bytes32
   */
  async getDomainSeparator(): Promise<string> {
    if (!this.contract.DOMAIN_SEPARATOR) {
      throw new Error('DOMAIN_SEPARATOR method not found on contract');
    }
    return await this.contract.DOMAIN_SEPARATOR();
  }

  /**
   * Get allocator for a specific tokenId
   * @param tokenId - Token identifier
   * @returns Allocator address
   */
  async allocatorOf(tokenId: BigNumberish): Promise<string> {
    if (!this.contract.allocatorOf) {
      throw new Error('allocatorOf method not found on contract');
    }
    return await this.contract.allocatorOf(tokenId);
  }

  /**
   * Check if an allocator can transfer tokens
   * @param allocator - Allocator address
   * @param tokenId - Token identifier
   * @returns True if can transfer
   */
  async canTransfer(allocator: string, tokenId: BigNumberish): Promise<boolean> {
    if (!this.contract.canTransfer) {
      throw new Error('canTransfer method not found on contract');
    }
    return await this.contract.canTransfer(allocator, tokenId);
  }

  /**
   * Get the underlying contract instance
   * @returns The ethers Contract instance
   */
  getContract(): Contract {
    return this.contract;
  }
} 