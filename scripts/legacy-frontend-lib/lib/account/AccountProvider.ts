/**
 * StreamPay Account Provider Interface & Implementations
 * Provides a unified interface for both Mera passkey and test/development accounts.
 */
import { createWalletClient, http, type WalletClient, type Account } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { monadTestnet } from './chains';

// ─── Interfaces ──────────────────────────────────────────────────────

export interface AccountProvider {
  readonly type: 'test' | 'mera';
  getAddress(): Promise<string>;
  signTypedData(params: {
    domain: any;
    types: Record<string, any>;
    primaryType: string;
    message: Record<string, any>;
  }): Promise<string>;
  createSessionSigner(): Promise<SessionSigner>;
  endSession(): Promise<void>;
}

export interface SessionSigner {
  getAddress(): string;
  signTypedData(params: {
    domain: any;
    types: Record<string, any>;
    primaryType: string;
    message: Record<string, any>;
  }): Promise<string>;
  end(): void;
}

// ─── Test Provider (Deterministic) ───────────────────────────────────

/**
 * TestProvider uses a deterministic private key for development/CI.
 * NOT for production. Uses a well-known test key.
 */
export class TestProvider implements AccountProvider {
  readonly type = 'test' as const;
  private account: Account;
  private sessionAccount: Account | null = null;

  constructor(privateKey?: `0x${string}`, network?: string) {
    const net = (network || process.env.NETWORK || process.env.NEXT_PUBLIC_NETWORK || '').toLowerCase();
    if (net === 'testnet' || net === 'mainnet') {
      throw new Error(`TestProvider is unavailable on ${net}. Injected wallet must be used on testnet and mainnet.`);
    }
    // Public Anvil test key. Never use on a real network.
    this.account = privateKeyToAccount(
      privateKey || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Anvil account #0
    );
  }

  async getAddress(): Promise<string> {
    return this.account.address;
  }

  async signTypedData(params: {
    domain: any;
    types: Record<string, any>;
    primaryType: string;
    message: Record<string, any>;
  }): Promise<string> {
    return (this.account as any).signTypedData({
      domain: params.domain,
      types: params.types,
      primaryType: params.primaryType,
      message: params.message,
    });
  }

  async createSessionSigner(): Promise<SessionSigner> {
    const key = generatePrivateKey();
    const sessionAccount = privateKeyToAccount(key);
    this.sessionAccount = sessionAccount;

    return {
      getAddress: () => sessionAccount.address,
      signTypedData: async (params) => {
        return sessionAccount.signTypedData({
          domain: params.domain,
          types: params.types,
          primaryType: params.primaryType,
          message: params.message,
        });
      },
      end: () => {
        this.sessionAccount = null;
      },
    };
  }

  async endSession(): Promise<void> {
    if (this.sessionAccount) {
      this.sessionAccount = null;
    }
  }
}

// ─── Creator Provider ────────────────────────────────────────────────

/**
 * CreatorProvider for signing offers and close acknowledgements.
 * Used by the access service / creator-side.
 */
export class CreatorProvider implements AccountProvider {
  readonly type = 'test' as const;
  private account: Account;

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);
  }

  async getAddress(): Promise<string> {
    return this.account.address;
  }

  async signTypedData(params: {
    domain: any;
    types: Record<string, any>;
    primaryType: string;
    message: Record<string, any>;
  }): Promise<string> {
    return (this.account as any).signTypedData({
      domain: params.domain,
      types: params.types,
      primaryType: params.primaryType,
      message: params.message,
    });
  }

  async createSessionSigner(): Promise<SessionSigner> {
    throw new Error('Creator does not create session signers');
  }

  async endSession(): Promise<void> {}
}
