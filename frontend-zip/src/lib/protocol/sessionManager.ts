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
import {
  buildContentOffer,
  signOffer,
  openSession as openRealSession,
  signVoucher as signRealVoucher,
  checkpoint as checkpointReal,
  signCloseAck,
  closeSession as closeRealSession,
  readVoucherDigest,
  readClaimable,
  claimRefund,
  requestClose as requestRealClose,
  finalizeAfterChallenge as finalizeRealAfterChallenge,
  readOnChainSession,
} from './realLifecycle';

export type NetworkType = 'local' | 'testnet';
export interface WalletState { address: Address | ''; chainId: number; network: NetworkType; isConnected: boolean; balanceUSDC: string; }
export interface VerificationLog { id: string; segmentIndex: number; timestamp: string; durationUnits: number; byteLength: number; segmentSha256: Hex; computedSha256: Hex; sha256Valid: boolean; leaf: Hex; merkleValid: boolean; proofLength: number; token: string; cumulativeUnits: string; mediaMimeType?: string; mediaData?: Uint8Array; }
export interface SessionEvent { id: string; type: string; timestamp: string; txHash?: Hex; detail?: string; }
export interface StreamSessionState {
  sessionId: Hex | null; status: 'inactive' | 'opening' | 'active' | 'checkpointing' | 'closing' | 'closed' | 'close_requested'; cumulativeUnits: number; settledUnits: number;
  initialDepositUSDC: string; unredeemedUSDC: string; sessionSigner: Address | ''; payer: Address | ''; recipient: Address | ''; contractAddress: Address | ''; paymentToken: Address | '';
  openedAt: number | null; lastTxHash: Hex | null; lastVoucherSignature: Hex | null; lastCloseAckSignature: Hex | null; verificationLogs: VerificationLog[]; events: SessionEvent[]; refundUSDC: string; refundStatus: 'not-finalized' | 'allocated' | 'claimable' | 'claimed' | 'credited' | 'unknown'; claimableUSDC: string; activeSegmentIndex: number | null; isSimulated: boolean; error: string | null; challengeEndsAt?: number | null;
}

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const LOCAL_CHAIN_ID = 31337;
export const MONAD_PAYMENT_TOKEN = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Address;
// The deployed settlement contract enforces this maximum unredeemed window.
// Checkpoint before requesting a voucher that would cross it.
const MAX_CREDIT_WINDOW_UNITS = 20n;
const simulationMode = import.meta.env?.VITE_STREAM_SIMULATION === 'true';
const sessionStorageKey = 'streampay.protocol.session.v1';
const signerStorageKey = 'streampay.session-signer.v1';
const simulationAccountKey = 'streampay.simulation-account.v1';

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

function getOrCreateSimulationKey(): Hex {
  const storage = browserSessionStorage();
  const existing = storage?.getItem(simulationAccountKey) || '';
  if (/^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as Hex;
  const created = generatePrivateKey();
  storage?.setItem(simulationAccountKey, created);
  return created;
}

const rpcFor = (network: NetworkType) =>
  network === 'testnet'
    ? (import.meta.env?.VITE_ALCHEMY_RPC_URL ||
       import.meta.env?.VITE_ENVIO_HYPER_RPC ||
       import.meta.env?.VITE_MONAD_TESTNET_RPC ||
       'https://testnet-rpc.monad.xyz')
    : (import.meta.env?.VITE_LOCAL_RPC || 'http://127.0.0.1:8545');
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
  return providers.find((provider: EthereumProvider) => provider.isMetaMask && !provider.isRabby) || providers.find((provider: EthereumProvider) => provider.isRabby) || providers[0];
}

async function selectedAccount(provider: EthereumProvider, requested?: string[]): Promise<string> {
  // accountsChanged is authoritative. Some wallet extensions briefly expose a
  // stale selectedAddress while the account switch is propagating.
  const accounts = requested || await provider.request({ method: 'eth_accounts' }) as string[];
  return accounts?.[0] || '';
}

function requireAddress(value: string, label: string): Address { if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is not configured as a valid address`); return value as Address; }

async function requestCurrentWalletAccounts(provider: EthereumProvider): Promise<string[]> {
  // Re-open the wallet account permission UI so switching accounts in the
  // extension also changes the account authorized for this site.
  try {
    await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: number }).code
      : undefined;
    // Rabby and some injected providers do not implement this optional method.
    // A user rejection must still stop the connection attempt.
    if (code === 4001) throw error;
  }
  return await provider.request({ method: 'eth_requestAccounts' }) as string[];
}

export class LocalTestProvider {
  constructor(network: string) { if (network === 'testnet' || network === 'mainnet') throw new Error(`Security Violation: LocalTestProvider is strictly forbidden on ${network}`); }
}

export class ProtocolLifecycleManager {
  private network: NetworkType = import.meta.env?.VITE_NETWORK === 'testnet' ? 'testnet' : 'local';
  private simulationAccount = privateKeyToAccount(getOrCreateSimulationKey());
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private listeners: (() => void)[] = [];
  private walletSource: 'injected' | 'external' | 'simulation' = simulationMode ? 'simulation' : 'injected';
  private wallet: WalletState = { address: '', chainId: LOCAL_CHAIN_ID, network: 'local', isConnected: simulationMode, balanceUSDC: '0' };
  private session: StreamSessionState = { sessionId: null, status: 'inactive', cumulativeUnits: 0, settledUnits: 0, initialDepositUSDC: '0', unredeemedUSDC: '0', sessionSigner: '', payer: '', recipient: '', contractAddress: '', paymentToken: '', openedAt: null, lastTxHash: null, lastVoucherSignature: null, lastCloseAckSignature: null, verificationLogs: [], events: [], refundUSDC: '0', refundStatus: 'not-finalized', claimableUSDC: '0', activeSegmentIndex: null, isSimulated: simulationMode, error: null };
  private creatorOffer: { offer: any; signature: Hex } | null = null;
  private creatorAddress: Address | '' = '';
  private payerAddress: Address | '' = '';
  private walletDisconnectRequested = false;
  private signerAccount = simulationMode ? this.simulationAccount : privateKeyToAccount(getOrCreateSignerKey());

  constructor() {
    if (this.network === 'testnet') {
      this.wallet.network = 'testnet';
      this.wallet.chainId = MONAD_TESTNET_CHAIN_ID;
      this.session.contractAddress = (import.meta.env?.VITE_SETTLEMENT_ADDRESS || '') as Address;
      this.session.paymentToken = MONAD_PAYMENT_TOKEN;
    }
    this.restorePersistedState();
    if (simulationMode) {
      this.walletSource = 'simulation';
      this.wallet.address = this.simulationAccount.address;
      this.wallet.isConnected = true;
      if (!this.session.payer) this.session.payer = this.simulationAccount.address;
      if (!this.session.sessionSigner) this.session.sessionSigner = this.simulationAccount.address;
      this.payerAddress = this.simulationAccount.address;
    }
    if (typeof window !== 'undefined') {
      try {
        const provider = injectedProvider();
        provider.on?.('accountsChanged', (accounts: unknown) => {
          void this.syncActiveAccount(Array.isArray(accounts) ? accounts as string[] : []);
        });
        provider.on?.('chainChanged', () => {
          void this.syncActiveAccount();
        });
        // Initial account check
        void this.syncActiveAccount();
        window.setInterval(() => { void this.syncActiveAccount(); }, 2000);
      } catch {}
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((x: () => void) => x !== cb); };
  }

  private persistState() {
    const storage = browserSessionStorage();
    if (!storage) return;
    try {
      const verificationLogs = this.session.verificationLogs.map(({ mediaData: _mediaData, ...log }: any) => log);
      storage.setItem(
        sessionStorageKey,
        JSON.stringify({
          session: { ...this.session, verificationLogs },
          creatorAddress: this.creatorAddress,
          creatorOffer: this.creatorOffer,
          payerAddress: this.payerAddress,
          wallet: {
            address: this.wallet.address,
            network: this.wallet.network,
            chainId: this.wallet.chainId,
            isConnected: this.wallet.isConnected,
            balanceUSDC: this.wallet.balanceUSDC,
          },
          walletSource: this.walletSource,
          walletDisconnectRequested: this.walletDisconnectRequested,
        })
      );
    } catch { /* Browser storage is optional; protocol state remains authoritative. */ }
  }

  private restorePersistedState() {
    const raw = browserSessionStorage()?.getItem(sessionStorageKey);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as {
        session?: Partial<StreamSessionState>;
        creatorAddress?: Address | '';
        creatorOffer?: { offer: any; signature: Hex } | null;
        payerAddress?: Address | '';
        wallet?: Partial<WalletState>;
        walletSource?: 'injected' | 'external' | 'simulation';
        walletDisconnectRequested?: boolean;
      };
      if (saved.session) {
        let status = saved.session.status || 'inactive';
        if (status === 'opening' || status === 'checkpointing' || status === 'closing') {
          status = saved.session.sessionId ? 'active' : 'inactive';
        }
        this.session = {
          ...this.session,
          ...saved.session,
          status,
          verificationLogs: saved.session.verificationLogs || [],
          events: saved.session.events || [],
        } as StreamSessionState;
      }
      if (saved.creatorAddress) this.creatorAddress = saved.creatorAddress;
      if (saved.creatorOffer) this.creatorOffer = saved.creatorOffer;
      if (saved.payerAddress) this.payerAddress = saved.payerAddress;
      if (saved.walletDisconnectRequested !== undefined) {
        this.walletDisconnectRequested = saved.walletDisconnectRequested;
      }
      if (saved.walletSource) {
        this.walletSource = saved.walletSource;
      }
      if (saved.wallet?.address && !this.walletDisconnectRequested) {
        this.wallet.address = saved.wallet.address as Address;
        this.wallet.isConnected = Boolean(saved.wallet.isConnected);
        if (saved.wallet.network) this.wallet.network = saved.wallet.network;
        if (saved.wallet.chainId) this.wallet.chainId = saved.wallet.chainId;
        if (saved.wallet.balanceUSDC) this.wallet.balanceUSDC = saved.wallet.balanceUSDC;
        if (!this.payerAddress) this.payerAddress = this.wallet.address;

        if (typeof window !== 'undefined' && window.ethereum && !simulationMode && this.walletSource === 'injected') {
          try {
            const provider = injectedProvider();
            this.walletClient = createWalletClient({
              account: this.wallet.address,
              chain: this.network === 'testnet' ? monadTestnetChain : undefined,
              transport: custom(provider as never),
            });
            void this.refreshBalance(this.wallet.address);
          } catch {}
        }
      }
    } catch {
      browserSessionStorage()?.removeItem(sessionStorageKey);
    }
  }

  private notify() {
    this.persistState();
    this.listeners.forEach((x: () => void) => x());
  }

  private addEvent(type: string, txHash?: Hex, detail?: string): void {
    this.session.events.unshift({ id: `${Date.now()}-${type}`, type, timestamp: new Date().toISOString(), txHash, detail });
  }

  getNetwork(): NetworkType { return this.network; }
  getWallet(): WalletState { return { ...this.wallet }; }
  getSession(): StreamSessionState { return { ...this.session, verificationLogs: [...this.session.verificationLogs] }; }
  getCreatorState(): { address: Address | ''; offerSigned: boolean; closeAckSigned: boolean } {
    return {
      address: this.creatorAddress,
      offerSigned: Boolean(this.creatorOffer),
      closeAckSigned: Boolean(this.session.lastCloseAckSignature),
    };
  }

  setCreatorAddress(value: string): void {
    const next = value.trim() as Address | '';
    if (this.creatorAddress && next.toLowerCase() !== this.creatorAddress.toLowerCase()) {
      this.creatorOffer = null;
      this.session.lastCloseAckSignature = null;
    }
    this.creatorAddress = next;
    this.notify();
  }

  resetCreatorAuthorization(): void {
    this.creatorAddress = '';
    this.creatorOffer = null;
    this.session.lastCloseAckSignature = null;
    this.notify();
  }

  async getActiveAccount(): Promise<Address> { return this.refreshInjectedWallet(); }
  async reconnectWallet(): Promise<void> { await this.connectWallet(); }

  private async ensureWalletClient(expected?: Address): Promise<ReturnType<typeof createWalletClient>> {
    if (this.walletClient && (!expected || this.wallet.address?.toLowerCase() === expected.toLowerCase())) {
      return this.walletClient;
    }
    await this.refreshInjectedWallet(expected);
    if (!this.walletClient) throw new Error('Wallet client not initialized. Unlock and connect your wallet extension.');
    return this.walletClient;
  }

  private async refreshBalance(address?: Address | ''): Promise<void> {
    const target = address || this.wallet.address;
    if (this.network === 'testnet' && target) {
      try {
        const balance = await createPublicClient({ transport: http(rpcFor(this.network)) }).readContract({
          address: MONAD_PAYMENT_TOKEN,
          abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
          functionName: 'balanceOf',
          args: [target as Address],
        });
        this.wallet.balanceUSDC = (Number(balance) / 1_000_000).toFixed(6);
      } catch {
        this.wallet.balanceUSDC = 'unavailable';
      }
    }
  }

  private async syncActiveAccount(requestedAccounts?: string[]): Promise<void> {
    if (!window.ethereum) return;
    if (this.walletDisconnectRequested) return;
    if (this.walletSource === 'external') return;
    try {
      const provider = injectedProvider();
      const accounts = requestedAccounts ?? await provider.request({ method: 'eth_accounts' }) as string[];
      if (!accounts.length) {
        if (this.walletSource === 'injected' && (this.wallet.isConnected || this.wallet.address)) {
          this.wallet.isConnected = false;
          this.wallet.address = '';
          this.wallet.balanceUSDC = '0';
          this.walletClient = null;
          this.notify();
        }
        return;
      }
      const active = accounts[0] as Address;
      let currentChainId = this.wallet.chainId;
      try {
        const chainHex = (await provider.request({ method: 'eth_chainId' })) as string;
        if (chainHex) currentChainId = Number(chainHex);
      } catch {}
      const accountChanged = !this.wallet.isConnected || !this.wallet.address || this.wallet.address.toLowerCase() !== active.toLowerCase();
      const chainChanged = this.wallet.chainId !== currentChainId;
      if (accountChanged || chainChanged) {
        this.walletSource = 'injected';
        this.wallet.chainId = currentChainId;
        await this.refreshInjectedWallet(active, accounts);
        await this.refreshBalance(active);
        this.wallet.isConnected = true;
        this.notify();
      }
    } catch {
      if (this.walletSource === 'injected' && (this.wallet.isConnected || this.wallet.address)) {
        this.wallet.isConnected = false;
        this.wallet.address = '';
        this.notify();
      }
    }
  }

  async syncExternalAccount(account: string): Promise<void> {
    if (!account) return;
    const addr = account as Address;
    this.walletSource = 'external';
    this.walletDisconnectRequested = false;
    this.wallet.address = addr;
    this.wallet.isConnected = true;
    if (!this.creatorAddress || addr.toLowerCase() !== this.creatorAddress.toLowerCase()) {
      this.payerAddress = addr;
      if (!this.session.payer || this.session.status === 'inactive') {
        this.session.payer = addr;
      }
    }
    await this.refreshBalance(addr);
    this.notify();
  }

  setNetwork(network: NetworkType): void {
    this.network = network;
    this.wallet.network = network;
    this.wallet.chainId = network === 'testnet' ? MONAD_TESTNET_CHAIN_ID : LOCAL_CHAIN_ID;
    this.session.contractAddress = network === 'testnet' ? (import.meta.env?.VITE_SETTLEMENT_ADDRESS || '') as Address : '';
    this.session.paymentToken = network === 'testnet' ? MONAD_PAYMENT_TOKEN : '';
    if (network === 'testnet' && simulationMode) {
      this.wallet.isConnected = false;
      this.wallet.address = '';
      this.session.payer = '';
      this.session.sessionSigner = '';
      this.session.isSimulated = false;
    }
    this.notify();
  }

  async connectWallet(): Promise<void> {
    this.walletDisconnectRequested = false;
    this.walletSource = 'injected';
    if (this.network === 'local' && simulationMode) { this.wallet.isConnected = true; this.notify(); return; }
    const provider = injectedProvider();
    const chainId = this.network === 'testnet' ? MONAD_TESTNET_CHAIN_ID : LOCAL_CHAIN_ID;
    const accounts = await requestCurrentWalletAccounts(provider);
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
    await this.refreshBalance(address);
    if (!this.creatorAddress || address.toLowerCase() !== this.creatorAddress.toLowerCase()) {
      this.payerAddress = address;
      this.session.payer = address;
    }
    this.session.isSimulated = false;
    this.notify();
  }

  private async refreshInjectedWallet(expected?: Address, requestedAccounts?: string[]): Promise<Address> {
    const provider = injectedProvider();
    const active = requireAddress(await selectedAccount(provider, requestedAccounts), 'Active wallet account');
    if (expected && active.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Rabby account mismatch. Expected ${expected}, but the active account is ${active}. Switch Rabby accounts and reconnect.`);
    }
    this.walletClient = createWalletClient({ account: active, chain: this.network === 'testnet' ? monadTestnetChain : undefined, transport: custom(provider as never) });
    this.wallet.address = active;
    return active;
  }

  disconnectWallet(): void {
    this.walletDisconnectRequested = true;
    this.walletSource = 'injected';
    this.wallet.isConnected = false;
    this.wallet.address = '';
    this.wallet.balanceUSDC = '0';
    this.walletClient = null;
    this.notify();
  }

  async signCreatorOffer(manifest: StreamManifest, creatorAddress: string): Promise<void> {
    const requestedCreator = requireAddress(creatorAddress.trim(), 'Creator wallet');
    await this.ensureWalletClient();
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
    const maxUnits = 20n;
    const offer = buildContentOffer({ recipient: creator, token: MONAD_PAYMENT_TOKEN, manifestRoot: manifest.manifestRoot, contentIdHash: manifest.contentIdHash, pricingPolicyHash: manifest.pricingPolicyHash, unitPrice, maxCreditSegments: Math.min(manifest.totalSegments, 5), maxCreditWindowUnits: maxUnits, maxUnredeemedAmount: unitPrice * maxUnits });
    const signature = await signOffer(this.walletClient!, requireAddress(this.session.contractAddress, 'Settlement contract'), creator, offer, MONAD_TESTNET_CHAIN_ID);
    this.creatorAddress = creator;
    this.creatorOffer = { offer, signature };
    this.notify();
  }

  async openPaymentSession(manifest: StreamManifest, depositUSDC = '0.0500'): Promise<Hex | null> {
    if (!this.wallet.isConnected && !simulationMode) {
      // Attempt silent auto-reconnect before rejecting
      try { await this.ensureWalletClient(); } catch { throw new Error('Connect a wallet first.'); }
    }
    this.session.status = 'opening';
    this.session.error = null;
    this.notify();
    try {
      if (!simulationMode) {
        if (this.network !== 'testnet') throw new Error('Real wallet opening is available on Monad Testnet only.');
        if (!this.creatorOffer) throw new Error('Creator signature required. Enter the Creator address, switch Rabby to that account, sign the offer, then switch back to the Payer.');
        await this.ensureWalletClient(requireAddress(this.payerAddress || this.session.payer || this.wallet.address, 'Payer wallet'));
        if (this.creatorOffer.offer.recipient.toLowerCase() === this.wallet.address.toLowerCase()) throw new Error('The stored Creator offer belongs to the Payer account. Reset Creator Authorization, select Account 2, and sign a new offer.');
        const deposit = BigInt(Math.round(Number(depositUSDC) * 1_000_000));
        const payer = requireAddress(this.wallet.address, 'Payer wallet');
        const result = await openRealSession({ walletClient: this.walletClient!, rpc: rpcFor(this.network), settlement: requireAddress(this.session.contractAddress, 'Settlement contract'), token: MONAD_PAYMENT_TOKEN, payer, recipient: this.creatorOffer.offer.recipient, signerAddress: this.signerAccount.address, manifestRoot: manifest.manifestRoot, offer: this.creatorOffer.offer, offerSignature: this.creatorOffer.signature, deposit, chainId: MONAD_TESTNET_CHAIN_ID });
        this.session.sessionId = result.sessionId;
        this.session.status = 'active';
        this.session.initialDepositUSDC = depositUSDC;
        this.session.openedAt = Date.now();
        this.session.isSimulated = false;
        this.session.lastTxHash = result.txHash;
        this.session.refundStatus = 'not-finalized';
        this.session.refundUSDC = '0';
        this.session.claimableUSDC = '0';
        this.session.contractAddress = requireAddress(this.session.contractAddress, 'Settlement contract');
        this.session.paymentToken = MONAD_PAYMENT_TOKEN;
        this.session.payer = this.wallet.address;
        this.session.recipient = this.creatorOffer.offer.recipient;
        this.session.sessionSigner = this.signerAccount.address;
        this.addEvent('Session opened', result.txHash);
        this.notify();
        return result.txHash;
      }
      const now = BigInt(Math.floor(Date.now() / 1000));
      const sessionId = keccak256(encodePacked(['address', 'bytes32', 'uint256'], [this.simulationAccount.address, manifest.manifestRoot, now]));
      this.session.sessionId = sessionId;
      this.session.status = 'active';
      this.session.initialDepositUSDC = depositUSDC;
      this.session.openedAt = Date.now();
      this.session.isSimulated = true;
      this.session.contractAddress = zeroAddress;
      this.session.paymentToken = '';
      this.session.refundStatus = 'not-finalized';
      this.session.refundUSDC = '0';
      this.session.claimableUSDC = '0';
      this.session.payer = this.simulationAccount.address;
      this.session.sessionSigner = this.simulationAccount.address;
      this.addEvent('Session opened', undefined, 'Simulation mode');
      this.notify();
      return null;
    } catch (err) {
      this.session.status = 'inactive';
      this.session.error = err instanceof Error ? err.message : 'Failed to open session';
      this.notify();
      throw err;
    }
  }

  private async signVoucher(sessionId: Hex, cumulativeUnits: bigint): Promise<Hex> {
    const domain = getStreamPayDomain(this.wallet.chainId, this.session.contractAddress || zeroAddress);
    const account = this.simulationModeAccount();
    return account.signTypedData({ domain, types: { Voucher: EIP712_TYPES.Voucher }, primaryType: 'Voucher', message: { sessionId, cumulativeUnits } });
  }
  private simulationModeAccount() { if (!simulationMode) throw new Error('Simulation signer unavailable outside simulation mode'); return this.simulationAccount; }

  async requestAndVerifySegment(manifest: StreamManifest, segmentIndex: number): Promise<VerificationLog> {
    if (!this.session.sessionId || this.session.status !== 'active') throw new Error('No active payment session.');
    const segment: SegmentManifest | undefined = manifest.segments[segmentIndex];
    if (!segment) throw new Error(`Segment ${segmentIndex} not found.`);
    this.session.activeSegmentIndex = segmentIndex;
    this.notify();
    const cumulativeUnits = BigInt(segment.cumulativeUnits);
    const settledUnits = BigInt(this.session.settledUnits);
    if (cumulativeUnits > settledUnits + MAX_CREDIT_WINDOW_UNITS) {
      if (this.session.cumulativeUnits <= this.session.settledUnits || !this.session.lastVoucherSignature) {
        throw new Error('Credit window is full. Checkpoint the current session before requesting another segment.');
      }
      await this.checkpointSession();
    }
    const signature = simulationMode
      ? await this.signVoucher(this.session.sessionId, cumulativeUnits)
      : await signRealVoucher(this.signerAccount, requireAddress(this.session.contractAddress, 'Settlement contract'), this.session.sessionId, cumulativeUnits, MONAD_TESTNET_CHAIN_ID);
    this.session.lastVoucherSignature = signature;
    const access = await accessService.requestSegmentAccess({
      sessionId: this.session.sessionId,
      sessionSigner: (this.session.sessionSigner || this.signerAccount.address) as Address,
      recipient: (this.session.recipient || zeroAddress) as Address,
      contractAddress: this.session.contractAddress || zeroAddress,
      chainId: this.wallet.chainId,
      streamId: manifest.streamId,
      segmentIndex,
      voucher: { sessionId: this.session.sessionId, cumulativeUnits: cumulativeUnits.toString(), signature },
    });
    const { data, byteLength, mimeType } = await accessService.fetchGatedContent(manifest.streamId, segmentIndex, access.segmentToken, access.contentUrl);
    const verification = await verifySegmentIntegrity(data, segment, manifest.manifestRoot);
    const leaf = computeSegmentLeaf(segment);
    const merkleValid = verifyMerkleProof(leaf, segment.merkleProof, manifest.manifestRoot);
    if (!verification.sha256Valid || !merkleValid) throw new Error('Segment integrity verification failed.');
    this.session.cumulativeUnits = Number(cumulativeUnits);
    this.session.unredeemedUSDC = ((Number(cumulativeUnits) * Number(manifest.unitPrice)) / 1_000_000).toFixed(6);
    const log: VerificationLog = { id: `verif-${Date.now()}-${segmentIndex}`, segmentIndex, timestamp: new Date().toISOString(), durationUnits: segment.durationUnits, byteLength, segmentSha256: segment.segmentSha256, computedSha256: verification.computedSha256, sha256Valid: verification.sha256Valid, leaf, merkleValid, proofLength: segment.merkleProof.length, token: access.segmentToken, cumulativeUnits: cumulativeUnits.toString(), mediaMimeType: mimeType, mediaData: data };
    this.session.verificationLogs.unshift(log);
    this.notify();
    return log;
  }

  async checkpointSession(): Promise<Hex | null> {
    if (!this.session.sessionId) throw new Error('No active session.');
    if (this.session.cumulativeUnits <= this.session.settledUnits) {
      throw new Error(`Already checkpointed up to ${this.session.settledUnits} units. Stream a video segment first to advance units before checkpointing.`);
    }
    if (simulationMode || this.session.isSimulated) {
      this.session.status = 'checkpointing';
      this.notify();
      try {
        await accessService.checkpointSync(this.session.sessionId, this.session.cumulativeUnits);
      } catch (err) {
        console.warn('Backend checkpoint sync warning (proceeding with local simulation):', err);
      }
      this.session.settledUnits = this.session.cumulativeUnits;
      this.session.status = 'active';
      this.addEvent('Checkpoint settled', undefined, `Simulation settled at ${this.session.settledUnits} units`);
      this.notify();
      return null;
    }
    if (!this.session.lastVoucherSignature) throw new Error('Play at least one segment to generate a signed voucher before checkpointing.');
    if (this.session.sessionSigner && this.signerAccount.address.toLowerCase() !== this.session.sessionSigner.toLowerCase()) {
      throw new Error(`Cannot submit checkpoint: Local session signer (${this.signerAccount.address}) does not match the on-chain session signer (${this.session.sessionSigner}). To protect your funds and prevent contract revert, please use "Refund Escrow" or "Request Unilateral Close" to reclaim your deposit safely.`);
    }
    await this.ensureWalletClient(requireAddress(this.session.payer || this.wallet.address, 'Payer wallet'));
    this.session.status = 'checkpointing';
    this.notify();
    const tx = await checkpointReal({
      walletClient: this.walletClient!,
      rpc: rpcFor(this.network),
      settlement: requireAddress(this.session.contractAddress, 'Settlement contract'),
      account: requireAddress(this.wallet.address, 'Payer wallet'),
      sessionId: this.session.sessionId,
      cumulativeUnits: BigInt(this.session.cumulativeUnits),
      voucherSig: this.session.lastVoucherSignature,
    });
    this.session.lastTxHash = tx;
    this.session.settledUnits = this.session.cumulativeUnits;
    this.addEvent('Checkpoint settled', tx, `Settled at ${this.session.settledUnits} units on-chain`);
    this.session.status = 'active';
    this.notify();
    return tx;
  }

  async closeSession(): Promise<Hex | null> {
    if (!this.session.sessionId) throw new Error('No active session.');
    if (simulationMode || this.session.isSimulated) {
      this.session.status = 'closing';
      this.notify();
      const deposit = Number(this.session.initialDepositUSDC) || 0;
      const billed = Number(this.session.unredeemedUSDC) || 0;
      const refund = Math.max(0, deposit - billed).toFixed(6);
      this.session.refundUSDC = refund;
      if (Number(refund) > 0) {
        const currentBal = Number(this.wallet.balanceUSDC) || 0;
        this.wallet.balanceUSDC = (currentBal + Number(refund)).toFixed(6);
        this.session.refundStatus = 'credited';
        this.session.claimableUSDC = '0';
        this.addEvent('Session closed / refund credited', undefined, `${refund} USDC refunded directly to wallet balance`);
      } else {
        this.session.refundStatus = 'not-finalized';
        this.session.claimableUSDC = '0';
        this.addEvent('Session closed', undefined, 'Session closed with full usage');
      }
      this.session.status = 'closed';
      this.session.settledUnits = this.session.cumulativeUnits;
      this.session.lastCloseAckSignature = null;
      this.session.lastTxHash = null;
      this.notify();
      return null;
    }
    if (!this.session.lastVoucherSignature && this.session.cumulativeUnits === 0) {
      this.session.lastVoucherSignature = await signRealVoucher(
        this.signerAccount,
        requireAddress(this.session.contractAddress, 'Settlement contract'),
        this.session.sessionId,
        0n,
        MONAD_TESTNET_CHAIN_ID
      );
    }
    if (!this.session.lastVoucherSignature || !this.session.lastCloseAckSignature) {
      throw new Error('Creator close authorization required. Click “Sign Creator Close Ack” with the Creator account first, then close as Payer.');
    }
    await this.ensureWalletClient(requireAddress(this.session.payer || this.wallet.address, 'Payer wallet'));
    this.session.status = 'closing';
    this.notify();
    const tx = await closeRealSession({
      walletClient: this.walletClient!,
      rpc: rpcFor(this.network),
      settlement: requireAddress(this.session.contractAddress, 'Settlement contract'),
      account: requireAddress(this.wallet.address, 'Payer wallet'),
      sessionId: this.session.sessionId,
      cumulativeUnits: BigInt(this.session.cumulativeUnits),
      voucherSig: this.session.lastVoucherSignature,
      ackSig: this.session.lastCloseAckSignature,
    });
    const deposit = Number(this.session.initialDepositUSDC) || 0;
    const billed = Number(this.session.unredeemedUSDC) || 0;
    const refund = Math.max(0, deposit - billed).toFixed(6);
    this.session.refundUSDC = refund;
    this.session.lastTxHash = tx;
    this.session.status = 'closed';
    this.session.settledUnits = this.session.cumulativeUnits;

    // Check on-chain balance and claimable amount
    if (this.wallet.address) await this.refreshBalance(this.wallet.address);
    const claimableAmount = await this.refreshClaimableRefund();
    if (Number(claimableAmount) > 0) {
      this.session.refundStatus = 'claimable';
      this.session.claimableUSDC = claimableAmount;
      this.addEvent('Session closed on-chain / claimable', tx, `${claimableAmount} USDC claimable from contract`);
    } else if (Number(refund) > 0) {
      // Monad settlement contract _safePayout transferred the refund directly to s.payer wallet
      this.session.refundStatus = 'credited';
      this.session.claimableUSDC = '0';
      this.addEvent('Session closed on-chain / refund credited', tx, `${refund} USDC refunded directly to wallet`);
    } else {
      this.session.refundStatus = 'not-finalized';
      this.session.claimableUSDC = '0';
      this.addEvent('Session closed on-chain', tx, 'Session closed with full usage');
    }
    this.notify();
    return tx;
  }

  async syncOnChainSession(sessionId?: Hex): Promise<void> {
    const id = sessionId || this.session.sessionId;
    if (!id || this.network !== 'testnet' || !this.session.contractAddress || this.session.contractAddress === zeroAddress) return;
    try {
      const s = await readOnChainSession(rpcFor(this.network), requireAddress(this.session.contractAddress, 'Settlement contract'), id);
      if (s) {
        if (s.status === 2) {
          this.session.status = 'close_requested';
          this.session.challengeEndsAt = Number(s.challengeEndsAt);
        } else if (s.status === 3) {
          this.session.status = 'closed';
        } else if (s.status === 1) {
          this.session.status = 'active';
        }
        if (s.initialDeposit) {
          this.session.initialDepositUSDC = (Number(s.initialDeposit) / 1_000_000).toFixed(4);
        }
        if (s.sessionSigner) {
          this.session.sessionSigner = s.sessionSigner;
        }
        if (s.payer) {
          this.session.payer = s.payer;
        }
        this.notify();
      }
    } catch (e) {
      console.warn('Failed to sync session from chain:', e);
    }
  }

  async refreshClaimableRefund(): Promise<string> {
    if (simulationMode || this.session.isSimulated || !this.wallet.address || !this.session.contractAddress || this.session.contractAddress === zeroAddress) {
      return this.session.claimableUSDC;
    }
    void this.syncOnChainSession();
    const amount = await readClaimable({
      rpc: rpcFor(this.network),
      settlement: requireAddress(this.session.contractAddress, 'Settlement contract'),
      token: MONAD_PAYMENT_TOKEN,
      account: requireAddress(this.wallet.address, 'Wallet'),
    });
    this.session.claimableUSDC = (Number(amount) / 1_000_000).toFixed(6);
    if (amount > 0n) this.session.refundStatus = 'claimable';
    this.notify();
    return this.session.claimableUSDC;
  }

  async claimRefund(): Promise<Hex | null> {
    if (simulationMode || this.session.isSimulated) {
      const amount = this.session.claimableUSDC || this.session.refundUSDC || '0';
      if (this.session.refundStatus === 'credited' || this.session.refundStatus === 'claimed') {
        throw new Error(`Refund of ${this.session.refundUSDC} USDC was already deposited directly into your wallet.`);
      }
      this.session.claimableUSDC = '0';
      this.session.refundStatus = 'claimed';
      const currentBal = Number(this.wallet.balanceUSDC) || 0;
      this.wallet.balanceUSDC = (currentBal + Number(amount)).toFixed(6);
      this.addEvent('Claimable refund claimed', undefined, `${amount} USDC refund claimed`);
      this.notify();
      return null;
    }
    await this.ensureWalletClient(requireAddress(this.wallet.address, 'Payer wallet'));
    const claimableOnChain = await readClaimable({
      rpc: rpcFor(this.network),
      settlement: requireAddress(this.session.contractAddress, 'Settlement contract'),
      token: MONAD_PAYMENT_TOKEN,
      account: requireAddress(this.wallet.address, 'Payer wallet'),
    });
    if (claimableOnChain === 0n) {
      if (this.wallet.address) await this.refreshBalance(this.wallet.address);
      this.session.claimableUSDC = '0';
      if (Number(this.session.refundUSDC) > 0) {
        this.session.refundStatus = 'credited';
      }
      this.notify();
      throw new Error(`No pending escrow tokens in contract to claim. Your refund (${this.session.refundUSDC} USDC) was already credited directly to your wallet upon session close.`);
    }
    const tx = await claimRefund({
      walletClient: this.walletClient!,
      rpc: rpcFor(this.network),
      settlement: requireAddress(this.session.contractAddress, 'Settlement contract'),
      token: MONAD_PAYMENT_TOKEN,
      account: requireAddress(this.wallet.address, 'Payer wallet'),
    });
    this.session.claimableUSDC = '0';
    this.session.refundStatus = 'claimed';
    this.session.lastTxHash = tx;
    if (this.wallet.address) await this.refreshBalance(this.wallet.address);
    this.addEvent('Claimable refund claimed', tx);
    this.notify();
    return tx;
  }

  async refundSession(): Promise<{ tx: Hex | null; refundAmount: string; message: string }> {
    if (!this.session.sessionId) throw new Error('No session active or available to refund.');

    // Case 1: Session is active or checkpointing: close and refund unspent escrow
    if (this.session.status === 'active' || this.session.status === 'checkpointing') {
      const deposit = Number(this.session.initialDepositUSDC) || 0;
      const billed = Number(this.session.unredeemedUSDC) || 0;
      const refund = Math.max(0, deposit - billed).toFixed(6);

      const isSignerMatch = !this.session.sessionSigner || this.signerAccount.address.toLowerCase() === this.session.sessionSigner.toLowerCase();
      const canCooperate = this.session.lastCloseAckSignature && isSignerMatch;

      if (canCooperate || simulationMode || this.session.isSimulated) {
        try {
          const tx = await this.closeSession();
          return {
            tx,
            refundAmount: refund,
            message: Number(refund) > 0
              ? `${refund} USDC refunded back to your wallet upon cooperative settlement.`
              : 'Session closed (all escrow consumed by streaming).',
          };
        } catch (closeErr) {
          console.warn('Cooperative close failed, falling back to unilateral close request:', closeErr);
        }
      }

      // Safe Unilateral Exit Fallback: Does not require voucher or creator signatures!
      const tx = await this.requestUnilateralClose();
      return {
        tx,
        refundAmount: refund,
        message: `Unilateral close successfully requested on-chain (Tx: ${tx}). Challenge period started; once elapsed, click 'Finalize Refund' to release your remaining ${refund} USDC.`,
      };
    }

    // Case 2: Session is in close_requested status -> Finalize challenge if window elapsed
    if ((this.session.status as string) === 'close_requested') {
      const tx = await this.finalizeCloseAfterChallenge();
      return {
        tx,
        refundAmount: this.session.refundUSDC || '0',
        message: `Challenge finalized! Full refund transferred directly to your wallet.`,
      };
    }

    // Case 3: Session is closed and has claimable escrow in contract
    if (Number(this.session.claimableUSDC) > 0) {
      const claimAmount = this.session.claimableUSDC;
      const tx = await this.claimRefund();
      return {
        tx,
        refundAmount: claimAmount,
        message: `${claimAmount} USDC claimed from contract escrow into your wallet.`,
      };
    }

    // Case 4: Session is closed and was already refunded/credited
    if (this.session.refundStatus === 'credited' || this.session.refundStatus === 'claimed') {
      return {
        tx: this.session.lastTxHash,
        refundAmount: this.session.refundUSDC,
        message: `Refund of ${this.session.refundUSDC} USDC is already deposited in your wallet balance.`,
      };
    }

    throw new Error('No refundable escrow available for this session.');
  }

  async requestUnilateralClose(): Promise<Hex | null> {
    if (!this.session.sessionId) throw new Error('No active session.');
    if (simulationMode || this.session.isSimulated) {
      return await this.closeSession();
    }
    await this.ensureWalletClient(requireAddress(this.session.payer || this.wallet.address, 'Payer wallet'));
    this.notify();
    const tx = await requestRealClose({
      walletClient: this.walletClient!,
      rpc: rpcFor(this.network),
      settlement: requireAddress(this.session.contractAddress, 'Settlement contract'),
      account: requireAddress(this.wallet.address, 'Payer wallet'),
      sessionId: this.session.sessionId,
    });
    this.session.status = 'close_requested';
    this.session.lastTxHash = tx;
    this.addEvent('Unilateral close requested', tx, '15-minute challenge period started on Monad');
    this.notify();
    return tx;
  }

  async finalizeCloseAfterChallenge(): Promise<Hex | null> {
    if (!this.session.sessionId) throw new Error('No session active.');
    if (simulationMode || this.session.isSimulated) {
      this.session.status = 'closed';
      this.notify();
      return null;
    }
    if (this.session.challengeEndsAt) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec < this.session.challengeEndsAt) {
        const diff = this.session.challengeEndsAt - nowSec;
        const min = Math.floor(diff / 60);
        const sec = diff % 60;
        throw new Error(`Monad security challenge period is currently active (${min}m ${sec}s remaining). Finalize will unlock at ${new Date(this.session.challengeEndsAt * 1000).toLocaleTimeString()} to release your refund.`);
      }
    }
    await this.ensureWalletClient(requireAddress(this.session.payer || this.wallet.address, 'Payer wallet'));
    const tx = await finalizeRealAfterChallenge({
      walletClient: this.walletClient!,
      rpc: rpcFor(this.network),
      settlement: requireAddress(this.session.contractAddress, 'Settlement contract'),
      account: requireAddress(this.wallet.address, 'Payer wallet'),
      sessionId: this.session.sessionId,
    });
    this.session.status = 'closed';
    this.session.lastTxHash = tx;
    this.session.refundStatus = 'credited';
    this.addEvent('Challenge finalized / refund credited', tx, 'Unspent escrow refunded to wallet');
    if (this.wallet.address) await this.refreshBalance(this.wallet.address);
    this.notify();
    return tx;
  }

  async signCreatorCloseAuthorization(): Promise<void> {
    if (!this.session.sessionId) throw new Error('An open session is required.');
    if (!this.creatorAddress) throw new Error('Creator address is not set.');
    await this.ensureWalletClient(this.creatorAddress);
    if (!this.session.lastVoucherSignature && this.session.cumulativeUnits === 0) {
      if (simulationMode) {
        this.session.lastVoucherSignature = await this.signVoucher(this.session.sessionId, 0n);
      } else {
        this.session.lastVoucherSignature = await signRealVoucher(
          this.signerAccount,
          requireAddress(this.session.contractAddress, 'Settlement contract'),
          this.session.sessionId,
          0n,
          MONAD_TESTNET_CHAIN_ID
        );
      }
    }
    const digest = await readVoucherDigest(rpcFor(this.network), requireAddress(this.session.contractAddress, 'Settlement contract'), this.session.sessionId, BigInt(this.session.cumulativeUnits));
    const sig = await signCloseAck(this.walletClient!, requireAddress(this.session.contractAddress, 'Settlement contract'), this.creatorAddress, this.session.sessionId, BigInt(this.session.cumulativeUnits), digest, MONAD_TESTNET_CHAIN_ID);
    this.session.lastCloseAckSignature = sig;
    this.notify();
  }
}

export const protocolManager = new ProtocolLifecycleManager();
