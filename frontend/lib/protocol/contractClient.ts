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
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import { monadTestnet } from '../account/chains';
import { STREAMPAY_SETTLEMENT_ABI } from './abi';
import { getStreamPayDomain, CONTENT_OFFER_TYPES, SESSION_CONFIG_TYPES, VOUCHER_TYPES, CLOSE_ACK_TYPES } from './typedData';

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
 * Computes contentOffer digest matching Solidity contract.
 */
export function computeContentOfferDigest(
  chainId: number,
  verifyingContract: Address,
  offer: any
): Hex {
  const domain = getStreamPayDomain(chainId, verifyingContract);
  // Typed data hashing
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('address, address, bytes32, bytes32, uint256, uint64, bytes32, uint8, uint64, uint256, uint256, uint64, uint64'),
      [
        offer.recipient,
        offer.token,
        offer.contentIdHash,
        offer.pricingPolicyHash,
        offer.unitPrice,
        offer.maxBillableUnits,
        offer.manifestRoot,
        offer.maxCreditSegments,
        offer.maxCreditWindowUnits,
        offer.maxUnredeemedAmount,
        offer.offerNonce,
        offer.issuedAt,
        offer.expiresAt,
      ]
    )
  );
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
