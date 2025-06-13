#!/usr/bin/env node
// run-solver-local.js - Start the OIF Protocol Solver for local testing
// Reads configuration from config/chains-local.json

const { OIFProtocolSolver } = require('./dist/src/index');
const { ConfigLoader } = require('./dist/src/config/ConfigLoader');
const path = require('path');

// Custom OIFProtocolSolver that uses configuration file
class ConfiguredOIFProtocolSolver extends OIFProtocolSolver {
  constructor(configPath) {
    // Load configuration from file
    const config = ConfigLoader.loadSolverConfig(configPath);
    
    // Call parent constructor with loaded config
    super(config);
    
    // Store config for later use
    this.chainsConfig = config._chainsConfig;
    this.configPath = configPath;
  }
  
  async start() {
    console.log('🏗️  Configuring ContractFactory with chains and contracts...');
    
    // Configure the ContractFactory with our configuration
    const { ContractFactory } = require('./dist/src/contracts/ContractFactory');
    ConfigLoader.configureContractFactory(this.contractFactory, this.chainsConfig);
    
    console.log('✅ ContractFactory configured successfully!');
    
    // Now start the solver
    return super.start();
  }
}

async function runSolverLocal() {
  console.log('🚀 Starting OIF Protocol Solver for LOCAL TESTING');
  console.log('='.repeat(60));

  try {
    // Load configuration from file
    const configPath = path.join(__dirname, 'config', 'chains-local.json');
    console.log(`📋 Loading configuration from: ${configPath}`);
    
    const solver = new ConfiguredOIFProtocolSolver(configPath);

    // Start the solver (this will configure ContractFactory and start services)
    await solver.start();

    console.log('✅ Solver is running and ready!');
    console.log();
    console.log('📡 API Endpoints:');
    console.log(`  http://localhost:3000/                    - API info`);
    console.log(`  http://localhost:3000/api/v1/health       - Health check`);
    console.log(`  http://localhost:3000/api/v1/orders       - Submit orders HERE`);
    console.log(`  http://localhost:3000/api/v1/queue        - Check queue`);
    console.log();
    console.log('🧪 Quick test:');
    console.log(`  curl http://localhost:3000/api/v1/health`);
    console.log();
    console.log('💡 To submit orders, use the format from your Step1_CreateOrder.s.sol');
    console.log('   but send via HTTP POST to /api/v1/orders instead of JSON files');
    console.log();
    console.log('🔄 The solver will automatically:');
    console.log('   1. Validate the order (replaces Step1 validation)');
    console.log('   2. Execute fill on destination chain (replaces Step2)');
    console.log('   3. Finalize on origin chain (replaces Step3)');
    console.log();
    console.log('⚙️  Configuration loaded from config file:');
    console.log(`   - Chains: ${solver.chainsConfig.chains.origin.name} + ${solver.chainsConfig.chains.destination.name}`);
    if (solver.chainsConfig.solver?.wallet) {
      console.log(`   - Wallet: ${solver.chainsConfig.solver.wallet.address}`);
    } else {
      console.log(`   - Wallet: Environment variable (SOLVER_PRIVATE_KEY)`);
    }
    console.log(`   - Signature validation: ${solver.chainsConfig.solver?.validation?.enableSignatureValidation ? 'ENABLED' : 'DISABLED'}`);
    console.log();
    console.log('Press Ctrl+C to stop the solver');

    // Keep running
    const keepAlive = () => {
      setTimeout(keepAlive, 1000);
    };
    keepAlive();

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\\n🛑 Shutting down solver...');
      await solver.stop();
      console.log('✅ Solver stopped');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\\n🛑 Received SIGTERM, shutting down...');
      await solver.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error starting solver:', error);
    if (error.message && error.message.includes('Configuration file not found')) {
      console.error('💡 Make sure config/chains-local.json exists');
      console.error('💡 You can copy the sample config from the repository');
    } else if (error.message && error.message.includes('Provider not found')) {
      console.error('💡 ContractFactory configuration failed');
      console.error('💡 Check chain configuration in config/chains-local.json');
    } else if (error.message && error.message.includes('Contract config not found')) {
      console.error('💡 Contract configuration missing');
      console.error('💡 Check contract addresses in config/chains-local.json');
    } else {
      console.error('💡 Make sure you ran: npm run build');
      console.error('💡 Make sure anvil chains are running on the configured ports');
    }
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

if (require.main === module) {
  runSolverLocal();
} 