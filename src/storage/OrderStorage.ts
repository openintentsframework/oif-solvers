// OrderStorage.ts - Simple order storage for the solver
// Provides basic order persistence and retrieval functionality

import { StandardOrder } from '../models/StandardOrder';

export interface StoredOrder {
  orderId: string;
  order: StandardOrder;
  signature: string;
  timestamp: number;
  status: 'pending' | 'processing' | 'filled' | 'expired' | 'failed';
  metadata?: {
    source?: string;
    clientId?: string;
    [key: string]: any;
  };
}

export interface OrderStorageConfig {
  persistToDisk: boolean;
  storageFilePath?: string;
  maxOrders: number;
  autoCleanup: boolean;
  cleanupInterval: number; // milliseconds
}

/**
 * Simple order storage for solver order persistence
 */
export class OrderStorage {
  private orders: Map<string, StoredOrder> = new Map();
  private config: OrderStorageConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<OrderStorageConfig> = {}) {
    this.config = {
      persistToDisk: false,
      storageFilePath: './solver-orders.json',
      maxOrders: 1000,
      autoCleanup: true,
      cleanupInterval: 60000, // 1 minute
      ...config
    };

    if (this.config.autoCleanup) {
      this.startAutoCleanup();
    }

    console.log('OrderStorage initialized');
  }

  /**
   * Store an order
   */
  async storeOrder(storedOrder: StoredOrder): Promise<void> {
    this.orders.set(storedOrder.orderId, storedOrder);
    
    // Enforce max orders limit
    if (this.orders.size > this.config.maxOrders) {
      await this.cleanup();
    }
    
    if (this.config.persistToDisk) {
      await this.saveOrders();
    }
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): StoredOrder | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Get all orders
   */
  getAllOrders(): StoredOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Get orders by status
   */
  getOrdersByStatus(status: StoredOrder['status']): StoredOrder[] {
    return Array.from(this.orders.values()).filter(order => order.status === status);
  }

  /**
   * Update order status
   */
  updateOrderStatus(orderId: string, status: StoredOrder['status']): boolean {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
      if (this.config.persistToDisk) {
        this.saveOrders().catch(console.error);
      }
      return true;
    }
    return false;
  }

  /**
   * Delete order
   */
  deleteOrder(orderId: string): boolean {
    const deleted = this.orders.delete(orderId);
    if (deleted && this.config.persistToDisk) {
      this.saveOrders().catch(console.error);
    }
    return deleted;
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    totalOrders: number;
    pending: number;
    processing: number;
    filled: number;
    failed: number;
    expired: number;
  } {
    const orders = this.getAllOrders();
    return {
      totalOrders: orders.length,
      pending: orders.filter(o => o.status === 'pending').length,
      processing: orders.filter(o => o.status === 'processing').length,
      filled: orders.filter(o => o.status === 'filled').length,
      failed: orders.filter(o => o.status === 'failed').length,
      expired: orders.filter(o => o.status === 'expired').length
    };
  }

  /**
   * Save orders to disk
   */
  private async saveOrders(): Promise<void> {
    if (!this.config.persistToDisk || !this.config.storageFilePath) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const ordersArray = Array.from(this.orders.entries());
      await fs.writeFile(
        this.config.storageFilePath,
        JSON.stringify(ordersArray, null, 2)
      );
    } catch (error) {
      console.error('Failed to save orders:', error);
    }
  }

  /**
   * Load orders from disk
   */
  async loadOrders(): Promise<void> {
    if (!this.config.persistToDisk || !this.config.storageFilePath) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const ordersFile = await fs.readFile(this.config.storageFilePath, 'utf8');
      const ordersArray: [string, StoredOrder][] = JSON.parse(ordersFile);
      this.orders = new Map(ordersArray);
      console.log(`Loaded ${this.orders.size} orders from disk`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to load orders:', error);
      }
      // File doesn't exist - start with empty storage
      this.orders = new Map();
    }
  }

  /**
   * Clean up old orders
   */
  private async cleanup(): Promise<void> {
    const orders = this.getAllOrders();
    
    // Remove oldest orders if over limit
    if (orders.length > this.config.maxOrders) {
      orders.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = orders.slice(0, orders.length - this.config.maxOrders);
      
      for (const order of toRemove) {
        this.orders.delete(order.orderId);
      }
      
      console.log(`Cleaned up ${toRemove.length} old orders`);
    }
  }

  /**
   * Start auto-cleanup timer
   */
  private startAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(console.error);
    }, this.config.cleanupInterval);
  }

  /**
   * Stop auto-cleanup timer
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopAutoCleanup();
    
    if (this.config.persistToDisk) {
      this.saveOrders().catch(console.error);
    }
  }
} 