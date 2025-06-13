// contracts.ts - Contract configuration for OIF Protocol Solver
// Includes contract addresses, ABIs, and chain-specific contract mappings

export interface ContractConfig {
  address: string;
  abi: any[];
  deploymentBlock?: number;
  version?: string;
}

export interface ChainContractConfig {
  chainId: number;
  networkName: string;
  contracts: {
    theCompact: ContractConfig;
    settlerCompact: ContractConfig;
    coinFiller: ContractConfig;
    mockERC20?: ContractConfig;
    oracle?: ContractConfig;
  };
}

/**
 * Contract Configuration Manager for OIF Protocol
 * Manages contract addresses and ABIs across chains
 */
export class ContractConfiguration {
  private chainConfigs: Map<number, ChainContractConfig> = new Map();
  
  constructor() {
    this.initializeDefaultContracts();
  }

  /**
   * Initialize default contract configurations
   */
  private initializeDefaultContracts(): void {
    // Local test chains (matching automation script addresses)
    this.addChainConfig({
      chainId: 31337,
      networkName: 'local-origin',
      contracts: {
        theCompact: {
          address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          abi: [],
          deploymentBlock: 1,
          version: '1.0.0'
        },
        settlerCompact: {
          address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          abi: [],
          deploymentBlock: 2,
          version: '1.0.0'
        },
        coinFiller: {
          address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
          abi: [],
          deploymentBlock: 3,
          version: '1.0.0'
        },
        mockERC20: {
          address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
          abi: [],
          deploymentBlock: 4,
          version: '1.0.0'
        }
      }
    });

    this.addChainConfig({
      chainId: 31338,
      networkName: 'local-destination',
      contracts: {
        theCompact: {
          address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          abi: [],
          deploymentBlock: 1,
          version: '1.0.0'
        },
        settlerCompact: {
          address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          abi: [],
          deploymentBlock: 2,
          version: '1.0.0'
        },
        coinFiller: {
          address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
          abi: [],
          deploymentBlock: 3,
          version: '1.0.0'
        },
        mockERC20: {
          address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
          abi: [],
          deploymentBlock: 4,
          version: '1.0.0'
        }
      }
    });

    // Testnet configurations
    this.addChainConfig({
      chainId: 11155111,
      networkName: 'sepolia',
      contracts: {
        theCompact: {
          address: '0x0000000000000000000000000000000000000000',
          abi: [],
          version: '1.0.0'
        },
        settlerCompact: {
          address: '0x0000000000000000000000000000000000000000',
          abi: [],
          version: '1.0.0'
        },
        coinFiller: {
          address: '0x0000000000000000000000000000000000000000',
          abi: [],
          version: '1.0.0'
        }
      }
    });

    this.addChainConfig({
      chainId: 80001,
      networkName: 'mumbai',
      contracts: {
        theCompact: {
          address: '0x0000000000000000000000000000000000000000',
          abi: [],
          version: '1.0.0'
        },
        settlerCompact: {
          address: '0x0000000000000000000000000000000000000000',
          abi: [],
          version: '1.0.0'
        },
        coinFiller: {
          address: '0x0000000000000000000000000000000000000000',
          abi: [],
          version: '1.0.0'
        },
        mockERC20: {
          address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Mumbai
          abi: [],
          version: '1.0.0'
        }
      }
    });
  }

  /**
   * Add chain contract configuration
   */
  addChainConfig(config: ChainContractConfig): void {
    this.chainConfigs.set(config.chainId, config);
  }

  /**
   * Get contract configuration for a specific chain
   */
  getChainConfig(chainId: number): ChainContractConfig | undefined {
    return this.chainConfigs.get(chainId);
  }

  /**
   * Get specific contract address on a chain
   */
  getContractAddress(chainId: number, contractName: keyof ChainContractConfig['contracts']): string | undefined {
    const chainConfig = this.getChainConfig(chainId);
    return chainConfig?.contracts[contractName]?.address;
  }

  /**
   * Get contract configuration for a specific contract on a chain
   */
  getContractConfig(chainId: number, contractName: keyof ChainContractConfig['contracts']): ContractConfig | undefined {
    const chainConfig = this.getChainConfig(chainId);
    return chainConfig?.contracts[contractName];
  }

  /**
   * Check if a contract is deployed on a chain
   */
  isContractDeployed(chainId: number, contractName: keyof ChainContractConfig['contracts']): boolean {
    const address = this.getContractAddress(chainId, contractName);
    return address !== undefined && address !== '0x0000000000000000000000000000000000000000';
  }

  /**
   * Get all supported chains
   */
  getSupportedChains(): number[] {
    return Array.from(this.chainConfigs.keys());
  }

  /**
   * Get chains where all core contracts are deployed
   */
  getFullyDeployedChains(): number[] {
    return this.getSupportedChains().filter(chainId => {
      const coreContracts: (keyof ChainContractConfig['contracts'])[] = [
        'theCompact', 'settlerCompact', 'coinFiller'
      ];
      
      return coreContracts.every(contractName => 
        this.isContractDeployed(chainId, contractName)
      );
    });
  }

  /**
   * Update contract address for a chain
   */
  updateContractAddress(
    chainId: number, 
    contractName: keyof ChainContractConfig['contracts'], 
    newAddress: string,
    deploymentBlock?: number
  ): boolean {
    const chainConfig = this.chainConfigs.get(chainId);
    if (!chainConfig) return false;

    const contractConfig = chainConfig.contracts[contractName];
    if (!contractConfig) return false;

    contractConfig.address = newAddress;
    if (deploymentBlock !== undefined) {
      contractConfig.deploymentBlock = deploymentBlock;
    }

    return true;
  }

  /**
   * Get deployment summary
   */
  getDeploymentSummary(): {
    chainId: number;
    networkName: string;
    deployedContracts: string[];
    missingContracts: string[];
    isFullyDeployed: boolean;
  }[] {
    return this.getSupportedChains().map(chainId => {
      const chainConfig = this.getChainConfig(chainId)!;
      const contractNames = Object.keys(chainConfig.contracts) as (keyof ChainContractConfig['contracts'])[];
      
      const deployedContracts: string[] = [];
      const missingContracts: string[] = [];
      
      contractNames.forEach(contractName => {
        if (this.isContractDeployed(chainId, contractName)) {
          deployedContracts.push(contractName);
        } else {
          missingContracts.push(contractName);
        }
      });

      const coreContracts = ['theCompact', 'settlerCompact', 'coinFiller'];
      const isFullyDeployed = coreContracts.every(name => deployedContracts.includes(name));

      return {
        chainId,
        networkName: chainConfig.networkName,
        deployedContracts,
        missingContracts,
        isFullyDeployed
      };
    });
  }
}

// Default global configuration instance
export const contractConfig = new ContractConfiguration();

// Export contract addresses for easy access
export const CONTRACT_ADDRESSES = {
  LOCAL_ORIGIN: contractConfig.getChainConfig(31337),
  LOCAL_DESTINATION: contractConfig.getChainConfig(31338),
  SEPOLIA: contractConfig.getChainConfig(11155111),
  MUMBAI: contractConfig.getChainConfig(80001)
};

export default contractConfig; 