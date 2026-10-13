import {
  type Address,
  type Hex,
  createPublicClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EIP712_TYPES, getStreamPayDomain } from './typedData';
const MONAD_TESTNET_CHAIN_ID = 10143;

const offerComponents = [
  { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' },
  { name: 'contentIdHash', type: 'bytes32' }, { name: 'pricingPolicyHash', type: 'bytes32' },
  { name: 'unitPrice', type: 'uint256' }, { name: 'maxBillableUnits', type: 'uint64' },
  { name: 'manifestRoot', type: 'bytes32' }, { name: 'maxCreditSegments', type: 'uint8' },
  { name: 'maxCreditWindowUnits', type: 'uint64' }, { name: 'maxUnredeemedAmount', type: 'uint256' },
  { name: 'offerNonce', type: 'uint256' }, { name: 'issuedAt', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
] as const;
const cfgComponents = [
  { name: 'payer', type: 'address' }, { name: 'sessionSigner', type: 'address' }, { name: 'offerDigest', type: 'bytes32' },
  { name: 'initialDeposit', type: 'uint256' }, { name: 'maxLeadUnits', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
  { name: 'redemptionGraceSeconds', type: 'uint64' }, { name: 'nonce', type: 'uint256' },
] as const;
const settlementAbi = [
  { type: 'function', name: 'hashContentOffer', stateMutability: 'view', inputs: [{ name: 'offer', type: 'tuple', components: offerComponents }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashSessionConfig', stateMutability: 'view', inputs: [{ name: 'cfg', type: 'tuple', components: cfgComponents }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashVoucher', stateMutability: 'view', inputs: [{ name: 'v', type: 'tuple', components: [{ name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' }] }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'openWithSignature', stateMutability: 'nonpayable', inputs: [{ name: 'offer', type: 'tuple', components: offerComponents }, { name: 'offerSig', type: 'bytes' }, { name: 'cfg', type: 'tuple', components: cfgComponents }, { name: 'cfgSig', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'checkpoint', stateMutability: 'nonpayable', inputs: [{ name: 'sessionId', type: 'bytes32' }, { name: 'voucher', type: 'tuple', components: [{ name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' }] }, { name: 'voucherSig', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'closeCooperative', stateMutability: 'nonpayable', inputs: [{ name: 'sessionId', type: 'bytes32' }, { name: 'voucher', type: 'tuple', components: [{ name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' }] }, { name: 'voucherSig', type: 'bytes' }, { name: 'ack', type: 'tuple', components: [{ name: 'sessionId', type: 'bytes32' }, { name: 'cumulativeUnits', type: 'uint64' }, { name: 'voucherDigest', type: 'bytes32' }] }, { name: 'ackSig', type: 'bytes' }], outputs: [] },
] as const;
const tokenAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const publicClient = (rpc: string) => createPublicClient({ transport: http(rpc) });
const domain = (settlement: Address, chainId: number) => getStreamPayDomain(chainId, settlement);

export function buildContentOffer(p: { recipient: Address; token: Address; manifestRoot: Hex; unitPrice: bigint; contentIdHash?: Hex; pricingPolicyHash?: Hex; now?: bigint }) {
  const now = p.now ?? BigInt(Math.floor(Date.now() / 1000));
  return {
    recipient: p.recipient, token: p.token,
    contentIdHash: p.contentIdHash || keccak256(new TextEncoder().encode('stream-content-monad-keynote-hd')),
    pricingPolicyHash: p.pricingPolicyHash || '0x76422f1e290b9f7982658421843336df3a5b54190454061ecfa6748f5987c500' as Hex,
    unitPrice: p.unitPrice, maxBillableUnits: 3600n, manifestRoot: p.manifestRoot,
    maxCreditSegments: 3, maxCreditWindowUnits: 10n, maxUnredeemedAmount: p.unitPrice * 10n,
    offerNonce: now, issuedAt: now, expiresAt: now + 86400n,
  };
}

export async function signOffer(walletClient: any, settlement: Address, creator: Address, offer: any, chainId = MONAD_TESTNET_CHAIN_ID): Promise<Hex> {
  return walletClient.signTypedData({ account: creator, domain: domain(settlement, chainId), types: { ContentOffer: EIP712_TYPES.ContentOffer }, primaryType: 'ContentOffer', message: offer });
}

export async function openSession(p: { walletClient: any; rpc: string; settlement: Address; token: Address; payer: Address; recipient: Address; signerAddress: Address; manifestRoot: Hex; offer: any; offerSignature: Hex; deposit: bigint; chainId?: number }): Promise<{ txHash: Hex; sessionId: Hex }> {
  const chainId = p.chainId ?? MONAD_TESTNET_CHAIN_ID;
  if (p.payer.toLowerCase() === p.recipient.toLowerCase() || p.payer.toLowerCase() === p.signerAddress.toLowerCase()) throw new Error('Payer, Creator, and session signer must be different accounts.');
  const pc = publicClient(p.rpc);
  const balance = await pc.readContract({ address: p.token, abi: tokenAbi, functionName: 'balanceOf', args: [p.payer] });
  if (balance < p.deposit) throw new Error(`Insufficient testnet USDC. Payer balance is ${Number(balance) / 1_000_000} USDC; required ${Number(p.deposit) / 1_000_000} USDC.`);
  const allowance = await pc.readContract({ address: p.token, abi: tokenAbi, functionName: 'allowance', args: [p.payer, p.settlement] });
  if (allowance < p.deposit) {
    const approval = await p.walletClient.writeContract({ address: p.token, abi: tokenAbi, functionName: 'approve', args: [p.settlement, p.deposit * 10n], account: p.payer });
    const receipt = await pc.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== 'success') throw new Error(`USDC approval failed: ${approval}`);
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const offerDigest = await pc.readContract({ address: p.settlement, abi: settlementAbi, functionName: 'hashContentOffer', args: [p.offer] }) as Hex;
  const cfg = { payer: p.payer, sessionSigner: p.signerAddress, offerDigest, initialDeposit: p.deposit, maxLeadUnits: 30n, validUntil: now + 3600n, redemptionGraceSeconds: 3600n, nonce: BigInt(Date.now()) };
  const cfgDigest = await pc.readContract({ address: p.settlement, abi: settlementAbi, functionName: 'hashSessionConfig', args: [cfg] }) as Hex;
  const cfgSig = await p.walletClient.signTypedData({ account: p.payer, domain: domain(p.settlement, chainId), types: { SessionConfig: EIP712_TYPES.SessionConfig }, primaryType: 'SessionConfig', message: cfg });
  const txHash = await p.walletClient.writeContract({ address: p.settlement, abi: settlementAbi, functionName: 'openWithSignature', args: [p.offer, p.offerSignature, cfg, cfgSig], account: p.payer });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error(`Session open failed: ${txHash}`);
  return { txHash, sessionId: keccak256(encodeAbiParameters(parseAbiParameters('bytes32, bytes32'), [cfgDigest, offerDigest])) };
}

export async function signVoucher(account: ReturnType<typeof privateKeyToAccount>, settlement: Address, sessionId: Hex, cumulativeUnits: bigint, chainId = MONAD_TESTNET_CHAIN_ID): Promise<Hex> {
  return account.signTypedData({ domain: domain(settlement, chainId), types: { Voucher: EIP712_TYPES.Voucher }, primaryType: 'Voucher', message: { sessionId, cumulativeUnits } });
}

export async function checkpoint(p: { walletClient: any; rpc: string; settlement: Address; account: Address; sessionId: Hex; cumulativeUnits: bigint; voucherSig: Hex }): Promise<Hex> {
  const txHash = await p.walletClient.writeContract({ address: p.settlement, abi: settlementAbi, functionName: 'checkpoint', args: [p.sessionId, { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits }, p.voucherSig], account: p.account });
  const receipt = await publicClient(p.rpc).waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error(`Checkpoint failed: ${txHash}`);
  return txHash;
}

export async function signCloseAck(walletClient: any, settlement: Address, creator: Address, sessionId: Hex, cumulativeUnits: bigint, voucherDigest: Hex, chainId = MONAD_TESTNET_CHAIN_ID): Promise<Hex> {
  return walletClient.signTypedData({ account: creator, domain: domain(settlement, chainId), types: { CloseAck: EIP712_TYPES.CloseAck }, primaryType: 'CloseAck', message: { sessionId, cumulativeUnits, voucherDigest } });
}

export async function closeSession(p: { walletClient: any; rpc: string; settlement: Address; account: Address; sessionId: Hex; cumulativeUnits: bigint; voucherSig: Hex; ackSig: Hex }): Promise<Hex> {
  const pc = publicClient(p.rpc);
  const voucher = { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits };
  const voucherDigest = await pc.readContract({ address: p.settlement, abi: settlementAbi, functionName: 'hashVoucher', args: [voucher] }) as Hex;
  const ack = { sessionId: p.sessionId, cumulativeUnits: p.cumulativeUnits, voucherDigest };
  const txHash = await p.walletClient.writeContract({ address: p.settlement, abi: settlementAbi, functionName: 'closeCooperative', args: [p.sessionId, voucher, p.voucherSig, ack, p.ackSig], account: p.account });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error(`Close failed: ${txHash}`);
  return txHash;
}

export async function readVoucherDigest(rpc: string, settlement: Address, sessionId: Hex, cumulativeUnits: bigint): Promise<Hex> {
  return await publicClient(rpc).readContract({ address: settlement, abi: settlementAbi, functionName: 'hashVoucher', args: [{ sessionId, cumulativeUnits }] }) as Hex;
}
