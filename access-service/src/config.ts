import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getAddress, isAddress, type Hex } from 'viem';

/**
 * All security-relevant values come from the SERVER (env / manifests), never from the HTTP request.
 */
export function readManifestSettlement(): string | undefined {
  try {
    const net = process.env.NETWORK === 'monad-testnet' ? 'testnet' : (process.env.NETWORK || 'local');
    const p = path.join(__dirname, '../../manifests', `${net}.json`);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8')).settlementContract || undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function readManifestPaymentToken(): { address?: Hex; expectedDecimals?: number } | undefined {
  try {
    const net = process.env.NETWORK === 'monad-testnet' ? 'testnet' : (process.env.NETWORK || 'local');
    const p = path.join(__dirname, '../../manifests', `${net}.json`);
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      const addr = parsed.paymentToken?.address;
      const dec = parsed.paymentToken?.expectedDecimals;
      return {
        address: addr && isAddress(addr) ? (getAddress(addr) as Hex) : undefined,
        expectedDecimals: typeof dec === 'number' ? dec : undefined,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const rawSettlement = process.env.SETTLEMENT_ADDRESS || readManifestSettlement();
const validSettlement = rawSettlement && isAddress(rawSettlement) ? (getAddress(rawSettlement) as Hex) : undefined;

export const config = {
  port: Number(process.env.PORT || 4001),
  PORT: Number(process.env.PORT || 4001),
  rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
  settlementAddress: validSettlement,
  SETTLEMENT_ADDRESS: validSettlement,
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  adminToken: process.env.ADMIN_TOKEN || '',
  streamIds: (process.env.STREAM_IDS || 'monad-keynote-hd,demo-stream').split(',').map((s) => s.trim()).filter(Boolean),
  minUnitPrice: BigInt(process.env.MIN_UNIT_PRICE || '10000'),
  tokenTtlSec: Number(process.env.TOKEN_TTL_SEC || 60),
  clockSkewSec: Number(process.env.CLOCK_SKEW_SEC || 5),
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 240),
  REQUIRE_ONCHAIN_SESSION: process.env.REQUIRE_ONCHAIN_SESSION === 'true',
  NETWORK: process.env.NETWORK || 'local',
  SIMULATION_MODE: process.env.SIMULATION_MODE === 'true',
  ENABLE_TEST_CLOCK: process.env.ENABLE_TEST_CLOCK === 'true',
  DATA_STORE_DIR: process.env.DATA_STORE_DIR !== undefined ? process.env.DATA_STORE_DIR : path.join(__dirname, '../../.streampay-data'),
  TOKEN_SECRET: process.env.TOKEN_SECRET,
  TRUSTED_PROXY_HOPS: Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS || 0)),
};

export function validateRuntimeConfiguration(): void {
  const nonLocal = config.NETWORK !== 'local';
  const production = process.env.NODE_ENV === 'production';
  if ((production || nonLocal) && config.DATA_STORE_DIR === 'memory') {
    throw new Error('Fatal: durable DATA_STORE_DIR is required outside local development.');
  }
  if ((production || nonLocal) && config.SIMULATION_MODE) {
    throw new Error('Fatal: SIMULATION_MODE is forbidden outside local development.');
  }
  if (nonLocal && !config.SETTLEMENT_ADDRESS) {
    throw new Error('Fatal: a valid deployed SETTLEMENT_ADDRESS is required outside local development.');
  }
  if (config.TRUSTED_PROXY_HOPS && !Number.isInteger(config.TRUSTED_PROXY_HOPS)) {
    throw new Error('Fatal: TRUSTED_PROXY_HOPS must be a non-negative integer.');
  }
}
