/**
 * StreamPay - Dynamic SDK Integration
 * Binds Dynamic embedded & EVM auth with Monad Testnet settlement rails.
 */
import { createDynamicClient, type DynamicClient } from '@dynamic-labs-sdk/client';
import { addEvmExtension } from '@dynamic-labs-sdk/evm';

let dynamicClientInstance: DynamicClient | null = null;

export function initDynamicClient(): DynamicClient | null {
  if (typeof window === 'undefined') return null;
  if (!dynamicClientInstance) {
    try {
      const environmentId =
        import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID || '2754a631-f95d-46e2-9b24-7f12e86d06d4';
      dynamicClientInstance = createDynamicClient({
        environmentId,
      });
      addEvmExtension(dynamicClientInstance);
    } catch (err) {
      console.warn('Dynamic client initialized with fallback:', err);
    }
  }
  return dynamicClientInstance;
}

export const dynamicClient = typeof window !== 'undefined' ? initDynamicClient() : null;
