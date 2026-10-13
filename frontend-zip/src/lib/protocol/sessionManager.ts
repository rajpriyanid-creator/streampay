import {
  type Address,
  type Hex,
  encodePacked,
  keccak256,
  createWalletClient,
  createPublicClient,
  http,
  custom,
  zeroAddress,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { StreamManifest, SegmentManifest, computeSegmentLeaf, verifyMerkleProof, verifySegmentIntegrity } from './manifest';
import { accessService } from './accessClient';
import { EIP712_TYPES, getStreamPayDomain } from './typedData';
import { buildContentOffer, signOffer, openSession as openRealSession, signVoucher as signRealVoucher, checkpoint as checkpointReal, signCloseAck, closeSession as closeRealSession, readVoucherDigest } from './realLifecycle';

export type NetworkType = 'local' | 'testnet';
export interface WalletState { address: Address | ''; chainId: number; network: NetworkType; isConnected: boolean; balanceUSDC: string; }
export interface VerificationLog { id: string; segmentIndex: number; timestamp: string; durationUnits: number; byteLength: number; segmentSha256: Hex; computedSha256: Hex; sha256Valid: boolean; leaf: Hex; merkleValid: boolean; proofLength: number; token: string; cumulativeUnits: string; mediaMimeType?: string; mediaData?: Uint8Array; }
export interface StreamSessionState {
  sessionId: Hex | null; status: 'inactive' | 'opening' | 'active' | 'checkpointing' | 'closing' | 'closed'; cumulativeUnits: number; settledUnits: number;
  initialDepositUSDC: string; unredeemedUSDC: string; sessionSigner: Address | ''; payer: Address | ''; recipient: Address | ''; contractAddress: Address | ''; paymentToken: Address | '';
  openedAt: number | null; lastTxHash: Hex | null; lastVoucherSignature: Hex | null; lastCloseAckSignature: Hex | null; verificationLogs: VerificationLog[]; activeSegmentIndex: number | null; isSimulated: boolean; error: string | null;
}

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const LOCAL_CHAIN_ID = 31337;
export const MONAD_PAYMENT_TOKEN = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Address;
const simulationMode = import.meta.env?.VITE_STREAM_SIMULATION === 'true';
const sessionStorageKey = 'streampay.protocol.session.v1';
const signerStorageKey = 'streampay.session-signer.v1';

function browserSessionStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function getOrCreateSignerKey(): Hex {
  const storage = browserSessionStorage();
  const existing = storage?.getItem(signerStorageKey) || '';
  if (/^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as Hex;
  const created = generatePrivateKey();
  storage?.setItem(signerStorageKey, created);
  return created;
}

const rpcFor = (network: NetworkType) => network === 'testnet' ? (import.meta.env?.VITE_MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz') : (import.meta.env?.VITE_LOCAL_RPC || 'http://127.0.0.1:8545');
const monadTestnetChain = {
  id: MONAD_TESTNET_CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' } },
} as const;

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?: (event: string, handler: (...args: unknown[]) => void) => void; removeListener?: (event: string, handler: (...args: unknown[]) => void) => void; isMetaMask?: boolean; isRabby?: boolean; selectedAddress?: string | null; providers?: EthereumProvider[] };
declare global { interface Window { ethereum?: EthereumProvider } }

function injectedProvider(): EthereumProvider {
  const root = window.ethereum;
  if (!root) throw new Error('No injected wallet found. Install and unlock MetaMask or Rabby.');
  const providers = root.providers?.length ? root.providers : [root];
  return providers.find((provider) => provider.isMetaMask && !provider.isRabby) || providers.find((provider) => provider.isRabby) || providers[0];
}

async function selectedAccount(provider: EthereumProvider, requested?: string[]): Promise<string> {
  const accounts = requested || await provider.request({ method: 'eth_accounts' }) as string[];
  const selected = provider.selectedAddress || '';
  return selected && accounts.some((account) => account.toLowerCase() === selected.toLowerCase()) ? selected : accounts?.[0] || '';
}

function requireAddress(value: string, label: string): Address { if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is not configured as a valid address`); return value as Address; }

export class LocalTestProvider {
  constructor(network: string) { if (network === 'testnet' || network === 'mainnet') throw new Error(`Security Violation: LocalTestProvider is strictly forbidden on ${network}`); }
}

export class ProtocolLifecycleManager {
  private network: NetworkType = import.meta.env?.VITE_NETWORK === 'testnet' ? 'testnet' : 'local';
  private simulationAccount = privateKeyToAccount(generatePrivateKey());
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private listeners: (() => void)[] = [];
  private wallet: WalletState = { address: '', chainId: LOCAL_CHAIN_ID, network: 'local', isConnected: simulationMode, balanceUSDC: '0' };
  private session: StreamSessionState = { sessionId: null, status: 'inactive', cumulativeUnits: 0, settledUnits: 0, initialDepositUSDC: '0', unredeemedUSDC: '0', sessionSigner: '', payer: '', recipient: '', contractAddress: '', paymentToken: '', openedAt: null, lastTxHash: null, lastVoucherSignature: null, lastCloseAckSignature: null, verificationLogs: [], activeSegmentIndex: null, isSimulated: simulationMode, error: null };
  private creatorOffer: { offer: any; signature: Hex } | null = null;
  private creatorAddress: Address | '' = '';
  private payerAddress: Address | '' = '';
  private signerAccount = simulationMode ? this.simulationAccount : privateKeyToAccount(getOrCreateSignerKey());

  constructor() {
    if (this.network === 'testnet') { this.wallet.network = 'testnet'; this.wallet.chainId = MONAD_TESTNET_CHAIN_ID; this.session.contractAddress = (import.meta.env?.VITE_SETTLEMENT_ADDRESS || '') as Address; this.session.paymentToken = MONAD_PAYMENT_TOKEN; }
    this.restorePersistedState();
    if (simulationMode) { this.wallet.address = this.simulationAccount.address; this.wallet.isConnected = true; this.session.payer = this.simulationAccount.address; this.session.sessionSigner = this.simulationAccount.address; }
    if (typeof window !== 'undefined') { try { const provider = injectedProvider(); provider.on?.('accountsChanged', () => { void this.syncActiveAccount(); }); provider.on?.('chainChanged', () => { void this.syncActiveAccount(); }); window.setInterval(() => { void this.syncActiveAccount(); }, 1000); } catch {} }
  }
  subscribe(cb: () => void): () => void { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter((x) => x !== cb); }; }
  private persistState() {
    const storage = browserSessionStorage();
    if (!storage) return;
    try {
      const verificationLogs = this.session.verificationLogs.map(({ mediaData: _mediaData, ...log }) => log);
      storage.setItem(sessionStorageKey, JSON.stringify({ session: { ...this.session, verificationLogs }, creatorAddress: this.creatorAddress, creatorOffer: this.creatorOffer }));
    } catch { /* Browser storage is optional; protocol state remains authoritative. */ }
  }
  private restorePersistedState() {
    const raw = browserSessionStorage()?.getItem(sessionStorageKey);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { session?: Partial<StreamSessionState>; creatorAddress?: Address | ''; creatorOffer?: { offer: any; signature: Hex } | null };
      if (saved.session?.status === 'active' || saved.session?.status === 'closed') {
        this.session = { ...this.session, ...saved.session, verificationLogs: saved.session.verificationLogs || [] } as StreamSessionState;
      }
      this.creatorAddress = saved.creatorAddress || '';
      this.creatorOffer = saved.creatorOffer || null;
    } catch { browserSessionStorage()?.removeItem(sessionStorageKey); }
  }
  private notify() { this.persistState(); this.listeners.forEach((x) => x()); }
  getNetwork(): NetworkType { return this.network; }
  getWallet(): WalletState { return { ...this.wallet }; }
  getSession(): StreamSessionState { return { ...this.session, verificationLogs: [...this.session.verificationLogs] }; }
  getCreatorState(): { address: Address | ''; offerSigned: boolean; closeAckSigned: boolean } { return { address: this.creatorAddress, offerSigned: Boolean(this.creatorOffer), closeAckSigned: Boolean(this.session.lastCloseAckSignature) }; }
  setCreatorAddress(value: string): void {
    const next = value.trim() as Address | '';
    if (this.creatorAddress && next.toLowerCase() !== this.creatorAddress.toLowerCase()) {
      this.creatorOffer = null;
      this.session.lastCloseAckSignature = null;
    }
    this.creatorAddress = next;
    this.notify();
  }
  resetCreatorAuthorization(): void { this.creatorAddress = ''; this.creatorOffer = null; this.session.lastCloseAckSignature = null; this.notify(); }
  async getActiveAccount(): Promise<Address> { return this.refreshInjectedWallet(); }
  async reconnectWallet(): Promise<void> { await this.connectWallet(); }

  private async syncActiveAccount(): Promise<void> {
    if (!window.ethereum) return;
    try {
      const provider = injectedProvider();
      const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
      const selected = provider.selectedAddress || '';
      if (selected && !accounts.some((account) => account.toLowerCase() === selected.toLowerCase())) {
        this.wallet.isConnected = false;
        this.wallet.address = '';
        this.wallet.balanceUSDC = '0';
        this.walletClient = null;
        this.notify();
        return;
      }
      await this.refreshInjectedWallet(); this.wallet.isConnected = true; this.notify();
    } catch { this.wallet.isConnected = false; this.wallet.address = ''; this.notify(); }
  }

  setNetwork(network: NetworkType): void {
    this.network = network; this.wallet.network = network; this.wallet.chainId = network === 'testnet' ? MONAD_TESTNET_CHAIN_ID : LOCAL_CHAIN_ID;
    this.session.contractAddress = network === 'testnet' ? (import.meta.env?.VITE_SETTLEMENT_ADDRESS || '') as Address : '';
    this.session.paymentToken = network === 'testnet' ? MONAD_PAYMENT_TOKEN : '';
    if (network === 'testnet' && simulationMode) { this.wallet.isConnected = false; this.wallet.address = ''; this.session.payer = ''; this.session.sessionSigner = ''; this.session.isSimulated = false; }
    this.notify();
  }

  async connectWallet(): Promise<void> {
    if (this.network === 'local' && simulationMode) { this.wallet.isConnected = true; this.notify(); return; }
    const provider = injectedProvider();
    const chainId = this.network === 'testnet' ? MONAD_TESTNET_CHAIN_ID : LOCAL_CHAIN_ID;
    const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    const address = requireAddress(await selectedAccount(provider, accounts), 'Selected wallet account');
    let actualChain = Number(await provider.request({ method: 'eth_chainId' }));
    if (actualChain !== chainId) {
      const targetHex = `0x${chainId.toString(16)}`;
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] });
      } catch (error: unknown) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: number }).code : undefined;
        if (this.network !== 'testnet' || code !== 4902) throw new Error(`Wrong chain. Expected ${chainId}, wallet is on ${actualChain}. Switch Rabby to the required network and try again.`);
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: targetHex,
            chainName: 'Monad Testnet',
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            rpcUrls: ['https://testnet-rpc.monad.xyz'],
            blockExplorerUrls: ['https://testnet.monadscan.com'],
          }],
        });
      }
      actualChain = Number(await provider.request({ method: 'eth_chainId' }));
    }
    const parsedChain = actualChain > 0xffff ? actualChain : actualChain;
    if (parsedChain !== chainId) throw new Error(`Wrong chain. Expected ${chainId}, wallet is on ${parsedChain}.`);
    this.walletClient = createWalletClient({ account: address, chain: this.network === 'testnet' ? monadTestnetChain : undefined, transport: custom(provider as never) });
    this.wallet = { address, chainId, network: this.network, isConnected: true, balanceUSDC: 'unknown' };
    if (this.network === 'testnet') {
      try {
        const balance = await createPublicClient({ transport: http(rpcFor(this.network)) }).readContract({ address: MONAD_PAYMENT_TOKEN, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [address] });
        this.wallet.balanceUSDC = (Number(balance) / 1_000_000).toFixed(6);
      } catch { this.wallet.balanceUSDC = 'unavailable'; }
    }
    if (!this.creatorAddress || address.toLowerCase() !== this.creatorAddress.toLowerCase()) {
      this.payerAddress = address;
      this.session.payer = address;
    }
    this.session.isSimulated = false; this.notify();
  }

  private async refreshInjectedWallet(expected?: Address): Promise<Address> {
    const provider = injectedProvider();
    const active = requireAddress(await selectedAccount(provider), 'Active wallet account');
    if (expected && active.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Rabby account mismatch. Expected ${expected}, but the active account is ${active}. Switch Rabby accounts and reconnect.`);
    }
    this.walletClient = createWalletClient({ account: active, chain: this.network === 'testnet' ? monadTestnetChain : undefined, transport: custom(provider as never) });
    this.wallet.address = active;
    return active;
  }

  disconnectWallet(): void { this.wallet.isConnected = false; this.wallet.address = ''; this.walletClient = null; this.notify(); }

  async signCreatorOffer(manifest: StreamManifest, creatorAddress: string): Promise<void> {
    if (!this.walletClient || !this.wallet.isConnected) throw new Error('Connect the Creator wallet before signing.');
    const requestedCreator = requireAddress(creatorAddress.trim(), 'Creator wallet');
    const activeAccount = await this.refreshInjectedWallet();
    let creator = requestedCreator;
    if (activeAccount.toLowerCase() !== requestedCreator.toLowerCase()) {
      if (activeAccount.toLowerCase() === this.payerAddress.toLowerCase()) {
        throw new Error(`Rabby is active on the Payer account ${activeAccount}. Switch to a different Creator account, or use “Use active Rabby account as Creator” only after selecting the Creator.`);
      }
      const acceptActive = window.confirm(`The active Rabby account is ${activeAccount}, but the entered Creator is ${requestedCreator}. Use the active account as Creator?`);
      if (!acceptActive) throw new Error('Creator signing cancelled. Switch Rabby to the entered Creator account or accept the active account.');
      creator = activeAccount;
    }
    this.creatorAddress = creator;
    if (creator.toLowerCase() === this.payerAddress.toLowerCase()) throw new Error('Creator and Payer must be different accounts.');
    if (!manifest.manifestRoot || !manifest.manifestRoot.startsWith('0x')) throw new Error('Manifest root is unavailable.');
    const unitPrice = BigInt(manifest.unitPrice);
    // The deployed settlement contract caps one credit window at 5 segments / 20 units.
    // Longer videos continue through checkpointing rather than signing an invalid offer.
    const maxUnits = 20n;
    const offer = buildContentOffer({ recipient: creator, token: MONAD_PAYMENT_TOKEN, manifestRoot: manifest.manifestRoot, contentIdHash: manifest.contentIdHash, pricingPolicyHash: manifest.pricingPolicyHash, unitPrice, maxCreditSegments: Math.min(manifest.totalSegments, 5), maxCreditWindowUnits: maxUnits, maxUnredeemedAmount: unitPrice * maxUnits });
    const signature = await signOffer(this.walletClient, requireAddress(this.session.contractAddress, 'Settlement contract'), creator, offer, MONAD_TESTNET_CHAIN_ID);
    this.creatorAddress = creator; this.creatorOffer = { offer, signature }; this.notify();
  }

  async openPaymentSession(manifest: StreamManifest, depositUSDC = '0.0500'): Promise<Hex | null> {
    if (!this.wallet.isConnected) throw new Error('Connect a wallet first.');
    this.session.status = 'opening'; this.session.error = null; this.notify();
    try {
      if (!simulationMode) {
        if (this.network !== 'testnet') throw new Error('Real wallet opening is available on Monad Testnet only.');
        if (!this.creatorOffer) throw new Error('Creator signature required. Enter the Creator address, switch Rabby to that account, sign the offer, then switch back to the Payer.');
        if (!this.walletClient) throw new Error('Connect the Payer wallet first.');
        await this.refreshInjectedWallet(requireAddress(this.payerAddress || this.session.payer || this.wallet.address, 'Payer wallet'));
        if (this.creatorOffer.offer.recipient.toLowerCase() === this.wallet.address.toLowerCase()) throw new Error('The stored Creator offer belongs to the Payer account. Reset Creator Authorization, select Account 2, and sign a new offer.');
        const deposit = BigInt(Math.round(Number(depositUSDC) * 1_000_000));
        const payer = requireAddress(this.wallet.address, 'Payer wallet');
        const result = await openRealSession({ walletClient: this.walletClient, rpc: rpcFor(this.network), settlement: requireAddress(this.session.contractAddress, 'Settlement contract'), token: MONAD_PAYMENT_TOKEN, payer, recipient: this.creatorOffer.offer.recipient, signerAddress: this.signerAccount.address, manifestRoot: manifest.manifestRoot, offer: this.creatorOffer.offer, offerSignature: this.creatorOffer.signature, deposit, chainId: MONAD_TESTNET_CHAIN_ID });
        this.session.sessionId = result.sessionId; this.session.status = 'active'; this.session.initialDepositUSDC = depositUSDC; this.session.openedAt = Date.now(); this.session.isSimulated = false; this.session.lastTxHash = result.txHash; this.session.contractAddress = requireAddress(this.session.contractAddress, 'Settlement contract'); this.session.paymentToken = MONAD_PAYMENT_TOKEN; this.session.payer = this.wallet.address; this.session.recipient = this.creatorOffer.offer.recipient; this.session.sessionSigner = this.signerAccount.address; this.notify(); return result.txHash;
      }
      const now = BigInt(Math.floor(Date.now() / 1000));
      const sessionId = keccak256(encodePacked(['address', 'bytes32', 'uint256'], [this.simulationAccount.address, manifest.manifestRoot, now]));
      this.session.sessionId = sessionId; this.session.status = 'active'; this.session.initialDepositUSDC = depositUSDC; this.session.openedAt = Date.now(); this.session.isSimulated = true; this.session.contractAddress = zeroAddress; this.session.paymentToken = ''; this.notify(); return null;
    } catch (err) { this.session.status = 'inactive'; this.session.error = err instanceof Error ? err.message : 'Failed to open session'; this.notify(); throw err; }
  }

  private async signVoucher(sessionId: Hex, cumulativeUnits: bigint): Promise<Hex> {
    const domain = getStreamPayDomain(this.wallet.chainId, this.session.contractAddress || zeroAddress);
    const account = this.simulationModeAccount();
    return account.signTypedData({ domain, types: { Voucher: EIP712_TYPES.Voucher }, primaryType: 'Voucher', message: { sessionId, cumulativeUnits } });
  }
  private simulationModeAccount() { if (!simulationMode) throw new Error('Simulation signer unavailable outside simulation mode'); return this.simulationAccount; }

  async requestAndVerifySegment(manifest: StreamManifest, segmentIndex: number): Promise<VerificationLog> {
    if (!this.session.sessionId || this.session.status !== 'active') throw new Error('No active payment session.');
    const segment: SegmentManifest | undefined = manifest.segments[segmentIndex]; if (!segment) throw new Error(`Segment ${segmentIndex} not found.`);
    this.session.activeSegmentIndex = segmentIndex; this.notify();
    const cumulativeUnits = BigInt(segment.cumulativeUnits);
    const signature = simulationMode ? await this.signVoucher(this.session.sessionId, cumulativeUnits) : await signRealVoucher(this.signerAccount, requireAddress(this.session.contractAddress, 'Settlement contract'), this.session.sessionId, cumulativeUnits, MONAD_TESTNET_CHAIN_ID);
    this.session.lastVoucherSignature = signature;
    const access = await accessService.requestSegmentAccess({ sessionId: this.session.sessionId, sessionSigner: (this.session.sessionSigner || this.simulationAccount.address) as Address, recipient: (this.session.recipient || zeroAddress) as Address, contractAddress: this.session.contractAddress || zeroAddress, chainId: this.wallet.chainId, streamId: manifest.streamId, segmentIndex, voucher: { sessionId: this.session.sessionId, cumulativeUnits: cumulativeUnits.toString(), signature } });
    const { data, byteLength, mimeType } = await accessService.fetchGatedContent(manifest.streamId, segmentIndex, access.segmentToken, access.contentUrl);
    const verification = await verifySegmentIntegrity(data, segment, manifest.manifestRoot);
    const leaf = computeSegmentLeaf(segment); const merkleValid = verifyMerkleProof(leaf, segment.merkleProof, manifest.manifestRoot);
    if (!verification.sha256Valid || !merkleValid) throw new Error('Segment integrity verification failed.');
    this.session.cumulativeUnits = Number(cumulativeUnits); this.session.unredeemedUSDC = ((Number(cumulativeUnits) * Number(manifest.unitPrice)) / 1_000_000).toFixed(6);
    const log: VerificationLog = { id: `verif-${Date.now()}-${segmentIndex}`, segmentIndex, timestamp: new Date().toISOString(), durationUnits: segment.durationUnits, byteLength, segmentSha256: segment.segmentSha256, computedSha256: verification.computedSha256, sha256Valid: verification.sha256Valid, leaf, merkleValid, proofLength: segment.merkleProof.length, token: access.segmentToken, cumulativeUnits: cumulativeUnits.toString(), mediaMimeType: mimeType, mediaData: data };
    this.session.verificationLogs.unshift(log); this.notify(); return log;
  }

  async checkpointSession(): Promise<Hex | null> {
    if (!this.session.sessionId) throw new Error('No active session');
    if (simulationMode) { this.session.status = 'checkpointing'; this.notify(); await accessService.checkpointSync(this.session.sessionId); this.session.settledUnits = this.session.cumulativeUnits; this.session.status = 'active'; this.notify(); return null; }
    if (!this.walletClient || !this.session.lastVoucherSignature) throw new Error('Play at least one segment before checkpointing.');
    await this.refreshInjectedWallet(requireAddress(this.session.payer, 'Payer wallet'));
    this.session.status = 'checkpointing'; this.notify();
    const tx = await checkpointReal({ walletClient: this.walletClient, rpc: rpcFor(this.network), settlement: requireAddress(this.session.contractAddress, 'Settlement contract'), account: requireAddress(this.wallet.address, 'Payer wallet'), sessionId: this.session.sessionId, cumulativeUnits: BigInt(this.session.cumulativeUnits), voucherSig: this.session.lastVoucherSignature });
    this.session.lastTxHash = tx; this.session.settledUnits = this.session.cumulativeUnits; this.session.status = 'active'; this.notify(); return tx;
  }

  async closeSession(): Promise<Hex | null> {
    if (!this.session.sessionId) throw new Error('No active session');
    if (simulationMode) { this.session.status = 'closing'; this.notify(); this.session.status = 'closed'; this.session.settledUnits = this.session.cumulativeUnits; this.session.lastCloseAckSignature = null; this.session.lastTxHash = null; this.notify(); return null; }
    if (!this.walletClient || !this.session.lastVoucherSignature || !this.session.lastCloseAckSignature) throw new Error('Creator close authorization is required. Switch to the Creator account and sign the current close authorization first.');
    await this.refreshInjectedWallet(requireAddress(this.session.payer, 'Payer wallet'));
    this.session.status = 'closing'; this.notify();
    const tx = await closeRealSession({ walletClient: this.walletClient, rpc: rpcFor(this.network), settlement: requireAddress(this.session.contractAddress, 'Settlement contract'), account: requireAddress(this.wallet.address, 'Payer wallet'), sessionId: this.session.sessionId, cumulativeUnits: BigInt(this.session.cumulativeUnits), voucherSig: this.session.lastVoucherSignature, ackSig: this.session.lastCloseAckSignature });
    this.session.lastTxHash = tx; this.session.status = 'closed'; this.session.settledUnits = this.session.cumulativeUnits; this.notify(); return tx;
  }

  async signCreatorCloseAuthorization(): Promise<void> {
    if (!this.walletClient || !this.session.sessionId) throw new Error('An open session is required.');
    if (!this.creatorAddress) throw new Error('Creator address is not set.');
    await this.refreshInjectedWallet(this.creatorAddress);
    const digest = await readVoucherDigest(rpcFor(this.network), requireAddress(this.session.contractAddress, 'Settlement contract'), this.session.sessionId, BigInt(this.session.cumulativeUnits));
    const sig = await signCloseAck(this.walletClient, requireAddress(this.session.contractAddress, 'Settlement contract'), this.creatorAddress, this.session.sessionId, BigInt(this.session.cumulativeUnits), digest, MONAD_TESTNET_CHAIN_ID);
    this.session.lastCloseAckSignature = sig; this.notify();
  }
}

export const protocolManager = new ProtocolLifecycleManager();
