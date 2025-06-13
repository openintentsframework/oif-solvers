// ContractFactory.ts - Creates contract instances for different chains 
import { ethers, Contract, JsonRpcProvider } from 'ethers';

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  name: string;
}

export interface ContractConfig {
  address: string;
  abi: any[];
}

export class ContractFactory {
  private providers: Map<number, JsonRpcProvider> = new Map();
  private contractConfigs: Map<string, ContractConfig> = new Map();

  constructor() {}

  /**
   * Add chain configuration with RPC provider
   */
  addChain(config: ChainConfig): void {
    const provider = new JsonRpcProvider(config.rpcUrl);
    this.providers.set(config.chainId, provider);
  }

  /**
   * Add contract configuration with address and ABI
   */
  addContract(name: string, config: ContractConfig): void {
    this.contractConfigs.set(name, config);
  }

  /**
   * Get provider for specific chain
   */
  getProvider(chainId: number): JsonRpcProvider {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider not found for chainId: ${chainId}`);
    }
    return provider;
  }

  /**
   * Create contract instance for specific chain
   */
  getContract(contractName: string, chainId: number, signerOrProvider?: any): Contract {
    const contractConfig = this.contractConfigs.get(contractName);
    if (!contractConfig) {
      throw new Error(`Contract config not found: ${contractName}`);
    }

    const provider = this.getProvider(chainId);
    const resolvedProvider = signerOrProvider || provider;

    return new Contract(contractConfig.address, contractConfig.abi, resolvedProvider);
  }

  /**
   * Get all configured chain IDs
   */
  getChainIds(): number[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all configured contract names
   */
  getContractNames(): string[] {
    return Array.from(this.contractConfigs.keys());
  }
} 