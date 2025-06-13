// OrderMonitoringService.ts - Simplified Order Reception (API Submission)
// Focuses only on receiving and validating orders from API submissions

import { StandardOrder } from '../models/StandardOrder';

export interface OrderValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface OrderSubmissionConfig {
  enableSignatureValidation: boolean;
  enableExpiryValidation: boolean;
  enableAmountValidation: boolean;
  maxOrderAge: number; // seconds
  minFillDeadline: number; // seconds before current time
}

// Export alias for API compatibility
export type OrderMonitoringConfig = OrderSubmissionConfig;

export interface QueueState {
  pending: Array<{
    orderId: string;
    order: StandardOrder;
    timestamp: number;
    priority: number;
  }>;
  processing: Array<{
    orderId: string;
    startTime: number;
    estimatedCompletion?: number;
  }>;
  completed: Array<{
    orderId: string;
    completedAt: number;
    success: boolean;
  }>;
}

export interface DetailedStats {
  submittedOrders: number;
  validOrders: number;
  rejectedOrders: number;
  acceptanceRate: number;
  currentQueueSize: number;
  profitableOrders: number;
  totalDiscovered: number;
  totalFiltered: number;
}

/**
 * Simplified Order Monitoring Service for API Submissions
 * Handles order validation and acceptance from API endpoints
 */
export class OrderMonitoringService {
  private config: OrderSubmissionConfig;
  private submittedOrders = 0;
  private validOrders = 0;
  private rejectedOrders = 0;
  private profitableOrders = 0;
  private totalDiscovered = 0;
  private totalFiltered = 0;
  private queue: QueueState = {
    pending: [],
    processing: [],
    completed: []
  };

  constructor(config: Partial<OrderSubmissionConfig> = {}) {
    this.config = {
      enableSignatureValidation: true,
      enableExpiryValidation: true,
      enableAmountValidation: true,
      maxOrderAge: 300, // 5 minutes
      minFillDeadline: 60, // 1 minute from now
      ...config
    };

    console.log('OrderMonitoringService initialized (simplified for API submissions)');
  }

  /**
   * Submit order from API endpoint
   * This is the main method for receiving orders through the API
   */
  async submitOffChainOrder(order: StandardOrder, signature: string, source?: string): Promise<boolean> {
    this.submittedOrders++;
    this.totalDiscovered++;
    
    try {
      console.log(`📨 Processing order submission for user ${order.user}`);

      // Validate the order
      const validation = await this.validateOrder(order, signature);
      
      if (!validation.isValid) {
        console.error('❌ Order validation failed:', validation.errors);
        this.rejectedOrders++;
        this.totalFiltered++;
        return false;
      }

      if (validation.warnings.length > 0) {
        console.warn('⚠️ Order validation warnings:', validation.warnings);
      }

      // Add to pending queue
      const orderId = this.generateOrderId(order);
      this.queue.pending.push({
        orderId,
        order,
        timestamp: Date.now(),
        priority: 1
      });

      // Simulate profitability check
      if (Math.random() > 0.3) { // 70% profitable
        this.profitableOrders++;
      }

      console.log(`✅ Order accepted for user ${order.user}, orderId: ${orderId}`);
      this.validOrders++;
      
      return true;

    } catch (error) {
      console.error('❌ Error processing order submission:', error);
      this.rejectedOrders++;
      this.totalFiltered++;
      return false;
    }
  }

  /**
   * Check if the service is monitoring (for API health checks)
   */
  isMonitoring(): boolean {
    return true; // Always monitoring in this simplified version
  }

  /**
   * Get queue state
   */
  getQueueState(): QueueState {
    return {
      pending: [...this.queue.pending],
      processing: [...this.queue.processing],
      completed: [...this.queue.completed]
    };
  }

  /**
   * Generate order ID from order data
   */
  private generateOrderId(order: StandardOrder): string {
    const data = `${order.user}-${order.nonce}-${Date.now()}`;
    // Simple hash - in practice would use proper hashing
    return '0x' + Buffer.from(data).toString('hex').slice(0, 32);
  }

  /**
   * Validate submitted order
   */
  private async validateOrder(order: StandardOrder, signature: string): Promise<OrderValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Basic structure validation
      if (!order) {
        errors.push('Order is null or undefined');
        return { isValid: false, errors, warnings };
      }

      if (!order.user || !order.user.startsWith('0x')) {
        errors.push('Invalid user address');
      }

      if (!order.originChainId || Number(order.originChainId) <= 0) {
        errors.push('Invalid origin chain ID');
      }

      // Expiry validation
      if (this.config.enableExpiryValidation) {
        const now = Math.floor(Date.now() / 1000);
        
        if (order.expires <= now) {
          errors.push(`Order already expired: expires ${order.expires}, now ${now}`);
        }

        if (order.fillDeadline <= now + this.config.minFillDeadline) {
          errors.push(`Fill deadline too close: ${order.fillDeadline}, minimum ${now + this.config.minFillDeadline}`);
        }

        const orderAge = now - (order.expires - this.config.maxOrderAge);
        if (orderAge > this.config.maxOrderAge) {
          warnings.push(`Order is older than ${this.config.maxOrderAge} seconds`);
        }
      }

      // Amount validation
      if (this.config.enableAmountValidation) {
        if (!order.inputs || order.inputs.length === 0) {
          errors.push('Order has no inputs');
        } else {
          for (const [tokenId, amount] of order.inputs) {
            if (amount <= 0) {
              errors.push(`Invalid input amount: ${amount}`);
            }
          }
        }

        if (!order.outputs || order.outputs.length === 0) {
          errors.push('Order has no outputs');
        } else {
          for (const output of order.outputs) {
            if (!output.amount || Number(output.amount) <= 0) {
              errors.push(`Invalid output amount: ${output.amount}`);
            }
            if (!output.token || !output.token.startsWith('0x')) {
              errors.push(`Invalid output token: ${output.token}`);
            }
            if (!output.recipient || !output.recipient.startsWith('0x')) {
              errors.push(`Invalid output recipient: ${output.recipient}`);
            }
          }
        }
      }

      // Signature validation (simplified - in practice would verify signature)
      if (this.config.enableSignatureValidation) {
        if (!signature || signature.length < 100) {
          errors.push('Invalid or missing signature');
        }
      }

      console.log(`📋 Order validation completed: ${errors.length} errors, ${warnings.length} warnings`);

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };

    } catch (error) {
      console.error('Error during order validation:', error);
      return {
        isValid: false,
        errors: [`Validation error: ${(error as Error).message}`],
        warnings
      };
    }
  }

  /**
   * Get service statistics (enhanced for API compatibility)
   */
  getStats(): DetailedStats {
    const acceptanceRate = this.submittedOrders > 0 
      ? (this.validOrders / this.submittedOrders) * 100 
      : 0;

    return {
      submittedOrders: this.submittedOrders,
      validOrders: this.validOrders,
      rejectedOrders: this.rejectedOrders,
      acceptanceRate,
      currentQueueSize: this.queue.pending.length,
      profitableOrders: this.profitableOrders,
      totalDiscovered: this.totalDiscovered,
      totalFiltered: this.totalFiltered
    };
  }

  /**
   * Get service configuration
   */
  getConfig(): OrderSubmissionConfig {
    return { ...this.config };
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<OrderSubmissionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('OrderMonitoringService config updated');
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.submittedOrders = 0;
    this.validOrders = 0;
    this.rejectedOrders = 0;
    this.profitableOrders = 0;
    this.totalDiscovered = 0;
    this.totalFiltered = 0;
    this.queue = {
      pending: [],
      processing: [],
      completed: []
    };
    console.log('OrderMonitoringService stats reset');
  }
} 