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

/**
 * Verify bytecode deployment on chain.
 */
export async function verifyContractDeployed(
  rpcHttp: string,
  contractAddress: Address
): Promise<boolean> {
  try {
    const client = getPublicClient(rpcHttp);
    const bytecode = await client.getBytecode({ address: contractAddress });
    return !!bytecode && bytecode !== '0x';
  } catch (err) {
    console.warn(`Contract bytecode check failed at ${contractAddress}:`, err);
    return false;
  }
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
