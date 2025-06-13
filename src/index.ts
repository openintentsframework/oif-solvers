// index.ts - Main Entry Point for OIF Protocol Solver (Simplified)
// Task 24: Implement Main Solver Entry Point with simplified architecture

// Load environment variables from .env file
import { config } from 'dotenv';
config();

import { OrderMonitoringService } from './services/OrderMonitoringService';
import { CrossChainService } from './services/CrossChainService';
import { FinalizationService } from './services/FinalizationService';
import { ContractFactory } from './contracts/ContractFactory';
import { OrderStorage } from './storage/OrderStorage';
import { SolverServer } from './SolverServer';

// Export ConfigLoader for external use
export { ConfigLoader } from './config/ConfigLoader';

/**
 * Simplified Solver Configuration
 */
interface SolverConfig {
  api: {
    port: number;
    host?: string;
  };
  crossChain: {
    gasMultiplier?: number;
    maxGasPrice?: bigint;
    retryAttempts?: number;
  };
  finalization: {
    gasMultiplier?: number;
    maxGasPrice?: bigint;
    retryAttempts?: number;
  };
  orderValidation: {
    enableSignatureValidation?: boolean;
    enableExpiryValidation?: boolean;
    minFillDeadline?: number;
  };
}

/**
 * Main Solver Class (Simplified)
 */
export class OIFProtocolSolver {
  private contractFactory: ContractFactory;
  private orderStorage: OrderStorage;
  private orderMonitoringService: OrderMonitoringService;
  private crossChainService: CrossChainService;
  private finalizationService: FinalizationService;
  private solverServer: SolverServer;
  private isRunning = false;

  constructor(config: Partial<SolverConfig> = {}) {
    const defaultConfig: SolverConfig = {
      api: {
        port: 3000,
        host: '0.0.0.0'
      },
      crossChain: {
        gasMultiplier: 1.2,
        maxGasPrice: BigInt('200000000000'), // 200 gwei
        retryAttempts: 3
      },
      finalization: {
        gasMultiplier: 1.3,
        maxGasPrice: BigInt('300000000000'), // 300 gwei
        retryAttempts: 3
      },
      orderValidation: {
        enableSignatureValidation: true,
        enableExpiryValidation: true,
        minFillDeadline: 60 // 1 minute
      }
    };

    const mergedConfig = this.mergeConfig(defaultConfig, config);

    // Initialize services
    this.contractFactory = new ContractFactory();
    
    // Initialize order storage
    this.orderStorage = new OrderStorage({
      persistToDisk: true,
      storageFilePath: './solver-orders.json',
      maxOrders: 1000,
      autoCleanup: true
    });
    
    this.orderMonitoringService = new OrderMonitoringService(mergedConfig.orderValidation);
    
    this.crossChainService = new CrossChainService(
      this.contractFactory,
      mergedConfig.crossChain
    );
    
    this.finalizationService = new FinalizationService(
      this.contractFactory,
      this.orderStorage,
      mergedConfig.finalization
    );

    this.solverServer = new SolverServer(
      this.orderMonitoringService,
      this.crossChainService,
      this.finalizationService,
      this.orderStorage,
      mergedConfig.api
    );

    console.log('🤖 OIF Protocol Solver initialized (simplified architecture)');
  }

  /**
   * Start the solver
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Solver is already running');
      return;
    }

    try {
      console.log('🚀 Starting OIF Protocol Solver...');

      // Start API server
      await this.solverServer.start();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      this.isRunning = true;
      console.log('✅ OIF Protocol Solver started successfully');
      console.log('   API endpoints available:');
      console.log('   - POST /api/v1/orders (submit orders)');
      console.log('   - GET /api/v1/health (health check)');
      console.log('   - GET /api/v1/orders/:orderId (order status)');

    } catch (error) {
      console.error('❌ Failed to start solver:', error);
      throw error;
    }
  }

  /**
   * Stop the solver
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping OIF Protocol Solver...');

    try {
      // Stop API server
      await this.solverServer.stop();

      this.isRunning = false;
      console.log('✅ OIF Protocol Solver stopped successfully');

    } catch (error) {
      console.error('❌ Error stopping solver:', error);
      throw error;
    }
  }

  /**
   * Check if solver is running
   */
  isServerRunning(): boolean {
    return this.isRunning && this.solverServer.isServerRunning();
  }

  /**
   * Get solver status and statistics
   */
  getStatus(): {
    isRunning: boolean;
    orderStats: any;
    crossChainHealth: boolean;
  } {
    return {
      isRunning: this.isServerRunning(),
      orderStats: this.orderMonitoringService.getStats(),
      crossChainHealth: true // Simplified
    };
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n📡 Received ${signal} signal, shutting down gracefully...`);
      
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      console.error('❌ Unhandled rejection:', reason);
      shutdown('unhandledRejection');
    });
  }

  /**
   * Merge configuration objects
   */
  private mergeConfig(defaultConfig: SolverConfig, userConfig: Partial<SolverConfig>): SolverConfig {
    return {
      api: { ...defaultConfig.api, ...userConfig.api },
      crossChain: { ...defaultConfig.crossChain, ...userConfig.crossChain },
      finalization: { ...defaultConfig.finalization, ...userConfig.finalization },
      orderValidation: { ...defaultConfig.orderValidation, ...userConfig.orderValidation }
    };
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Create solver with configuration from environment variables
    const config: Partial<SolverConfig> = {
      api: {
        port: parseInt(process.env.SOLVER_PORT || '3000'),
        host: process.env.SOLVER_HOST || '0.0.0.0'
      },
      crossChain: {
        maxGasPrice: process.env.MAX_GAS_PRICE ? BigInt(process.env.MAX_GAS_PRICE) : undefined,
        retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3')
      }
    };

    const solver = new OIFProtocolSolver(config);

    // Start the solver
    await solver.start();

    // Keep the process running
    console.log('🎯 Solver is running. Use Ctrl+C to stop.');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the solver if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  });
} 