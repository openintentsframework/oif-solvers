// StateManager.ts - Simple state management for the solver
// Provides basic state persistence and retrieval functionality

export interface StateData {
  [key: string]: any;
}

export interface StateManagerConfig {
  persistToDisk: boolean;
  stateFilePath?: string;
  autoSave: boolean;
  saveInterval: number; // milliseconds
}

/**
 * Simple state manager for solver state persistence
 */
export class StateManager {
  private state: StateData = {};
  private config: StateManagerConfig;
  private saveTimer?: NodeJS.Timeout;

  constructor(config: Partial<StateManagerConfig> = {}) {
    this.config = {
      persistToDisk: false,
      stateFilePath: './solver-state.json',
      autoSave: true,
      saveInterval: 10000, // 10 seconds
      ...config
    };

    if (this.config.autoSave) {
      this.startAutoSave();
    }

    console.log('StateManager initialized');
  }

  /**
   * Get state value by key
   */
  get<T = any>(key: string): T | undefined {
    return this.state[key] as T;
  }

  /**
   * Set state value by key
   */
  set<T = any>(key: string, value: T): void {
    this.state[key] = value;
    
    if (this.config.persistToDisk && !this.config.autoSave) {
      this.saveState().catch(console.error);
    }
  }

  /**
   * Get all state data
   */
  getAll(): StateData {
    return { ...this.state };
  }

  /**
   * Update multiple state values
   */
  update(updates: StateData): void {
    this.state = { ...this.state, ...updates };
    
    if (this.config.persistToDisk && !this.config.autoSave) {
      this.saveState().catch(console.error);
    }
  }

  /**
   * Delete state value by key
   */
  delete(key: string): boolean {
    if (key in this.state) {
      delete this.state[key];
      return true;
    }
    return false;
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.state = {};
    
    if (this.config.persistToDisk) {
      this.saveState().catch(console.error);
    }
  }

  /**
   * Save state to disk
   */
  async saveState(): Promise<void> {
    if (!this.config.persistToDisk || !this.config.stateFilePath) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      await fs.writeFile(
        this.config.stateFilePath,
        JSON.stringify(this.state, null, 2)
      );
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  /**
   * Load state from disk
   */
  async loadState(): Promise<void> {
    if (!this.config.persistToDisk || !this.config.stateFilePath) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const stateFile = await fs.readFile(this.config.stateFilePath, 'utf8');
      this.state = JSON.parse(stateFile);
      console.log('State loaded from disk');
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to load state:', error);
      }
      // File doesn't exist - start with empty state
      this.state = {};
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }

    this.saveTimer = setInterval(() => {
      if (this.config.persistToDisk) {
        this.saveState().catch(console.error);
      }
    }, this.config.saveInterval);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): StateManagerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<StateManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (this.config.autoSave) {
      this.startAutoSave();
    } else {
      this.stopAutoSave();
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopAutoSave();
    
    if (this.config.persistToDisk) {
      this.saveState().catch(console.error);
    }
  }
} 