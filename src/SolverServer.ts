// SolverServer.ts - Simplified API Server for OIF Protocol Solver
// Provides endpoint to receive orders directly (no JSON file compatibility needed)

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { OrderMonitoringService } from './services/OrderMonitoringService';
import { CrossChainService } from './services/CrossChainService';
import { FinalizationService } from './services/FinalizationService';
import { OrderStorage, StoredOrder } from './storage/OrderStorage';
import { StandardOrder } from './models/StandardOrder';

export interface APIConfig {
  port: number;
  host?: string;
  cors?: {
    origin: string[];
    credentials?: boolean;
  };
}

export interface SubmitOrderRequest {
  order: StandardOrder;
  signature: string;
  metadata?: {
    source?: string;
    priority?: number;
  };
}

export interface SubmitOrderResponse {
  success: boolean;
  orderId: string;
  message: string;
  queuePosition?: number;
}

export interface OrderStatusResponse {
  orderId: string;
  status: 'pending' | 'processing' | 'filled' | 'finalized' | 'failed';
  queuePosition?: number;
  submittedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Simplified API Server for OIF Protocol Solver
 * Focuses on order submission and status endpoints
 */
export class SolverServer {
  private app: express.Application;
  private server: any;
  private config: APIConfig;
  private isRunning = false;

  constructor(
    private orderMonitoringService: OrderMonitoringService,
    private crossChainService: CrossChainService,
    private finalizationService: FinalizationService,
    private orderStorage: OrderStorage,
    config: APIConfig
  ) {
    this.config = {
      host: '0.0.0.0',
      cors: {
        origin: ['*'], // Allow all origins for simplicity
        credentials: true
      },
      ...config
    };

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: this.config.cors?.origin,
      credentials: this.config.cors?.credentials
    }));

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        error: 'Too many requests, please try again later'
      }
    });
    this.app.use('/api/', limiter);

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    const router = express.Router();

    // Health check
    router.get('/health', this.getHealth.bind(this));

    // Submit order - Main endpoint for receiving orders
    router.post('/orders', this.submitOrder.bind(this));

    // Get order status
    router.get('/orders/:orderId', this.getOrderStatus.bind(this));

    // Get queue state
    router.get('/queue', this.getQueueState.bind(this));

    this.app.use('/api/v1', router);

    // Root endpoint
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        name: 'OIF Protocol Solver API',
        version: '1.0.0',
        endpoints: {
          health: 'GET /api/v1/health',
          submitOrder: 'POST /api/v1/orders',
          orderStatus: 'GET /api/v1/orders/:orderId',
          queue: 'GET /api/v1/queue',
          sponsorSignature: 'POST /api/v1/signatures/sponsor-signature',
          completeOrder: 'POST /api/v1/signatures/complete-order'
        }
      });
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
      });
    });

    // Global error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      console.error('API Error:', err);
      res.status(500).json({
        error: 'Internal server error',
        message: err.message
      });
    });
  }

  /**
   * Health check endpoint
   */
  private async getHealth(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          orderMonitoring: true,
          crossChainService: true,
          finalizationService: true
        }
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: (error as Error).message
      });
    }
  }

  /**
   * Submit order endpoint - Main entry point for orders
   * This replaces the JSON file approach from Step1/Step2/Step3
   */
  private async submitOrder(req: Request, res: Response): Promise<void> {
    try {
      const { order, signature, metadata }: SubmitOrderRequest = req.body;

      // Validate input
      if (!order || !signature) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: order and signature'
        });
        return;
      }

      console.log('📨 Received order submission:', {
        user: order.user,
        originChain: order.originChainId,
        expires: order.expires
      });

      // Submit to order monitoring service (same as Step1 equivalent)
      const success = await this.orderMonitoringService.submitOffChainOrder(
        order,
        signature
      );

      if (!success) {
        res.status(422).json({
          success: false,
          orderId: 'unknown',
          message: 'Failed to process order'
        });
        return;
      }

      // Calculate order ID (simple approach for now)
      const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // Store order with signature in OrderStorage for later retrieval during finalization
      const storedOrder: StoredOrder = {
        orderId,
        order,
        signature,
        timestamp: Date.now(),
        status: 'pending',
        metadata: {
          source: metadata?.source || 'api',
          ...metadata
        }
      };

      await this.orderStorage.storeOrder(storedOrder);
      console.log(`💾 Order ${orderId} stored with signature for finalization`);

      // Start processing pipeline (Step2 + Step3 equivalent)
      this.processOrderAsync(orderId, order).catch(error => {
        console.error('Error processing order:', error);
        // Update order status to failed
        this.orderStorage.updateOrderStatus(orderId, 'failed');
      });

      const response: SubmitOrderResponse = {
        success: true,
        orderId,
        message: 'Order submitted and processing started',
        queuePosition: 1 // Simplified
      };

      res.status(201).json(response);
      console.log(`✅ Order ${orderId} submitted successfully`);

    } catch (error) {
      console.error('Error submitting order:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: (error as Error).message
      });
    }
  }

  /**
   * Process order asynchronously (Step2 + Step3 equivalent)
   * This replaces the manual Step2/Step3 script execution
   */
  private async processOrderAsync(orderId: string, order: StandardOrder): Promise<void> {
    try {
      console.log(`🔄 Starting processing for order ${orderId}`);

      // Update status to processing
      this.orderStorage.updateOrderStatus(orderId, 'processing');

      // Step 2 equivalent: Execute fill on destination chain
      console.log(`⛓️  Executing fill for order ${orderId}...`);
      
      // Use the new CrossChainService API - pass the order data
      const fillResult = await this.crossChainService.executeFill(orderId, order);

      if (fillResult.success) {
        console.log(`✅ Fill successful for order ${orderId}`);

        // Step 3 equivalent: Execute finalization on origin chain
        console.log(`⛓️  Executing finalization for order ${orderId}...`);
        
        // Use the new FinalizationService API - it will retrieve the stored order with signature
        const finalizeResult = await this.finalizationService.finalizeOrder(orderId);

        if (finalizeResult.success) {
          console.log(`🎉 Order ${orderId} completed successfully!`);
          this.orderStorage.updateOrderStatus(orderId, 'filled');
        } else {
          console.error(`❌ Finalization failed for order ${orderId}`);
          this.orderStorage.updateOrderStatus(orderId, 'failed');
        }
      } else {
        console.error(`❌ Fill failed for order ${orderId}`);
        this.orderStorage.updateOrderStatus(orderId, 'failed');
      }

    } catch (error) {
      console.error(`❌ Error processing order ${orderId}:`, error);
      this.orderStorage.updateOrderStatus(orderId, 'failed');
    }
  }

  /**
   * Get order status endpoint
   */
  private async getOrderStatus(req: Request, res: Response): Promise<void> {
    try {
      const { orderId } = req.params;

      if (!orderId) {
        res.status(400).json({
          error: 'Order ID is required'
        });
        return;
      }

      // Simplified status tracking for now
      const response = this.orderStorage.getOrder(orderId);

      res.json(response);

    } catch (error) {
      console.error('Error getting order status:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get queue state endpoint
   */
  private async getQueueState(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      });
    } catch (error) {
      console.error('Error getting queue state:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message
      });
    }
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('SolverServer already running');
      return;
    }

    return new Promise((resolve, reject) => {
      const host = this.config.host || '0.0.0.0';
      this.server = this.app.listen(this.config.port, host, () => {
        this.isRunning = true;
        console.log(`🚀 OIF Protocol Solver API started`);
        console.log(`   Host: ${host}:${this.config.port}`);
        console.log(`   Submit orders: POST http://${host}:${this.config.port}/api/v1/orders`);
        console.log(`   Health check: GET http://${host}:${this.config.port}/api/v1/health`);
        resolve();
      });

      this.server.on('error', (error: Error) => {
        console.error('Failed to start SolverServer:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the API server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        this.isRunning = false;
        console.log('SolverServer stopped');
        resolve();
      });
    });
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }
} 