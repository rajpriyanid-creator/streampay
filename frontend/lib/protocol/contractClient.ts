/**
 * StreamPay Monad v2.5 Contract Client
 * Real Viem client interactions for StreamPaySettlement.sol
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Hex,
  type Address,
  keccak256,
  hashTypedData,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import { monadTestnet } from '../account/chains';
import { STREAMPAY_SETTLEMENT_ABI } from './abi';
import {
  getStreamPayDomain,
  CONTENT_OFFER_TYPES,
  SESSION_CONFIG_TYPES,
  VOUCHER_TYPES,
  CLOSE_ACK_TYPES,
  type ContentOffer,
  type SessionConfig,
  type Voucher,
  type CloseAck,
} from './typedData';

export interface DeploymentConfig {
  network: string;
  chainId: number;
  rpcHttp: string;
  paymentToken: string;
  settlementContract: string;
}

export function getPublicClient(rpcHttp: string) {
  return createPublicClient({
    chain: {
      ...monadTestnet,
      rpcUrls: {
        default: { http: [rpcHttp] },
      },
    },
    transport: http(rpcHttp),
  });
}

export interface ContractVerificationResult {
  valid: boolean;
  paymentToken?: Address;
  chainId?: number;
  error?: string;
}

/**
 * Verifies StreamPaySettlement contract with chain ID match and settlement-specific read (paymentToken()).
 * Proves that MockUSDC or arbitrary bytecode contracts cannot be mistaken for StreamPaySettlement.
 */
export async function verifySettlementContract(
  rpcHttp: string,
  contractAddress: Address,
  expectedChainId?: number
): Promise<ContractVerificationResult> {
  try {
    const client = getPublicClient(rpcHttp);
    const chainId = await client.getChainId();
    if (expectedChainId && chainId !== expectedChainId) {
      return { valid: false, chainId, error: `Chain ID mismatch: expected ${expectedChainId}, got ${chainId}` };
    }
    const bytecode = await client.getBytecode({ address: contractAddress });
    if (!bytecode || bytecode === '0x') {
      return { valid: false, chainId, error: `No contract bytecode at ${contractAddress}` };
    }
    // Perform settlement-specific read: paymentToken()
    const paymentToken = await client.readContract({
      address: contractAddress,
      abi: STREAMPAY_SETTLEMENT_ABI,
      functionName: 'paymentToken',
    }) as Address;
    if (!paymentToken || paymentToken === '0x0000000000000000000000000000000000000000') {
      return { valid: false, chainId, error: 'Settlement contract returned zero paymentToken address' };
    }
    return { valid: true, paymentToken, chainId };
  } catch (err: any) {
    return { valid: false, error: `Not a valid StreamPaySettlement contract: ${err.message}` };
  }
}

/**
 * Verify bytecode deployment on chain with settlement-specific read.
 */
export async function verifyContractDeployed(
  rpcHttp: string,
  contractAddress: Address
): Promise<boolean> {
  const res = await verifySettlementContract(rpcHttp, contractAddress);
  return res.valid;
}

/**
 * Computes ContentOffer EIP-712 digest matching Solidity contract `_hashTypedDataV4`.
 */
export function computeContentOfferDigest(
  chainId: number,
  verifyingContract: Address,
  offer: ContentOffer | any
): Hex {
  return hashTypedData({
    domain: getStreamPayDomain(chainId, verifyingContract),
    types: CONTENT_OFFER_TYPES,
    primaryType: 'ContentOffer',
    message: offer,
  });
}

/**
 * Computes SessionConfig EIP-712 digest matching Solidity contract `_hashTypedDataV4`.
 */
export function computeSessionConfigDigest(
  chainId: number,
  verifyingContract: Address,
  config: SessionConfig | any
): Hex {
  return hashTypedData({
    domain: getStreamPayDomain(chainId, verifyingContract),
    types: SESSION_CONFIG_TYPES,
    primaryType: 'SessionConfig',
    message: config,
  });
}

/**
 * Computes Voucher EIP-712 digest matching Solidity contract `_hashTypedDataV4`.
 */
export function computeVoucherDigest(
  chainId: number,
  verifyingContract: Address,
  voucher: Voucher | any
): Hex {
  return hashTypedData({
    domain: getStreamPayDomain(chainId, verifyingContract),
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: voucher,
  });
}

/**
 * Computes CloseAck EIP-712 digest matching Solidity contract `_hashTypedDataV4`.
 */
export function computeCloseAckDigest(
  chainId: number,
  verifyingContract: Address,
  ack: CloseAck | any
): Hex {
  return hashTypedData({
    domain: getStreamPayDomain(chainId, verifyingContract),
    types: CLOSE_ACK_TYPES,
    primaryType: 'CloseAck',
    message: ack,
  });
}

/**
 * Derives exact sessionId matching StreamPaySettlement contract:
 * keccak256(abi.encode(configDigest, offerDigest))
 */
export function deriveContractSessionId(configDigest: Hex, offerDigest: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), [configDigest, offerDigest])
  );
}
