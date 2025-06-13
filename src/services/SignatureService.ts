// SignatureService.ts - Signature validation for orders
// Provides signature verification and generation functionality

import { ethers } from 'ethers';
import { StandardOrder } from '../models/StandardOrder';

export interface OrderSignature {
  signature: string;
  signer: string;
  timestamp: number;
}

export interface SignatureServiceConfig {
  enableVerification: boolean;
  requiredSigners: string[]; // Array of allowed signer addresses
  signatureTimeout: number; // Signature validity in seconds
}

/**
 * Service for handling order signature validation
 */
export class SignatureService {
  private config: SignatureServiceConfig;

  constructor(config: Partial<SignatureServiceConfig> = {}) {
    this.config = {
      enableVerification: true,
      requiredSigners: [],
      signatureTimeout: 300, // 5 minutes
      ...config
    };

    console.log('SignatureService initialized');
  }

  /**
   * Verify order signature
   */
  async verifyOrderSignature(order: StandardOrder, signature: OrderSignature): Promise<boolean> {
    if (!this.config.enableVerification) {
      return true; // Skip verification if disabled
    }

    try {
      // Check signature age
      const now = Math.floor(Date.now() / 1000);
      if (signature.timestamp + this.config.signatureTimeout < now) {
        console.error('Signature expired');
        return false;
      }

      // Create order hash for verification
      const orderHash = this.createOrderHash(order);
      
      // Recover signer from signature
      const recoveredSigner = ethers.verifyMessage(orderHash, signature.signature);
      
      // Check if recovered signer matches claimed signer
      if (recoveredSigner.toLowerCase() !== signature.signer.toLowerCase()) {
        console.error('Signature signer mismatch');
        return false;
      }

      // Check if signer is authorized (if required signers list is specified)
      if (this.config.requiredSigners.length > 0) {
        const isAuthorized = this.config.requiredSigners.some(
          signer => signer.toLowerCase() === signature.signer.toLowerCase()
        );
        
        if (!isAuthorized) {
          console.error('Signer not authorized');
          return false;
        }
      }

      return true;

    } catch (error) {
      console.error('Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Create order hash for signing
   */
  private createOrderHash(order: StandardOrder): string {
    // Simple order hash - in practice would use proper domain separation
    const orderString = JSON.stringify({
      user: order.user,
      nonce: order.nonce.toString(),
      originChainId: order.originChainId.toString(),
      expires: order.expires,
      fillDeadline: order.fillDeadline,
      inputs: order.inputs.map(([tokenId, amount]) => [tokenId.toString(), amount.toString()]),
      outputs: order.outputs
    });
    
    return ethers.id(orderString);
  }

  /**
   * Generate signature for order (for testing)
   */
  async signOrder(order: StandardOrder, privateKey: string): Promise<OrderSignature> {
    const wallet = new ethers.Wallet(privateKey);
    const orderHash = this.createOrderHash(order);
    const signature = await wallet.signMessage(orderHash);
    
    return {
      signature,
      signer: wallet.address,
      timestamp: Math.floor(Date.now() / 1000)
    };
  }

  /**
   * Get service configuration
   */
  getConfig(): SignatureServiceConfig {
    return { ...this.config };
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<SignatureServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('SignatureService config updated:', newConfig);
  }
} 