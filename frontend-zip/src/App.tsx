/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { MetricsGrid } from './components/MetricsGrid';
import { SegmentsList } from './components/SegmentsList';
import { RightSidebar } from './components/RightSidebar';
import {
  OpenSessionModal,
  ProofInspectorModal,
} from './components/Modals';
import { ManifestView, ManifestModal } from './components/ManifestView';
import { PaymentsView } from './components/PaymentsView';
import { DocsView } from './components/DocsView';
import { SettingsView } from './components/SettingsView';
import { SessionView } from './components/SessionView';
import { Film } from 'lucide-react';

import {
  protocolManager,
  WalletState,
  StreamSessionState,
  VerificationLog,
  NetworkType,
} from './lib/protocol/sessionManager';
import { accessService, HealthResponse } from './lib/protocol/accessClient';
import { StreamManifest, SegmentManifest } from './lib/protocol/manifest';

export default function App() {
  // Protocol State
  const [wallet, setWallet] = useState<WalletState>(protocolManager.getWallet());
  const [session, setSession] = useState<StreamSessionState>(protocolManager.getSession());
  const [network, setNetwork] = useState<NetworkType>(protocolManager.getNetwork());
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // App Navigation & UI State
  const [isOpenManifestModal, setIsOpenManifestModal] = useState(false);
  const [activeNav, setActiveNav] = useState<'overview' | 'segments' | 'manifest' | 'payments' | 'session' | 'settings' | 'docs'>(() => {
    try {
      const saved = window.localStorage.getItem('streampay.active-nav.v1');
      if (saved && ['overview', 'segments', 'manifest', 'payments', 'session', 'settings', 'docs'].includes(saved)) {
        return saved as any;
      }
    } catch {}
    return 'overview';
  });
  const computedActiveTab: 'stream' | 'payments' | 'docs' =
    activeNav === 'payments' || activeNav === 'session' ? 'payments' :
    activeNav === 'docs' ? 'docs' : 'stream';
  const [currentStreamId, setCurrentStreamId] = useState(() => {
    try { return window.localStorage.getItem('streampay.current-stream.v1') || 'monad-keynote-hd'; } catch { return 'monad-keynote-hd'; }
  });
  const [manifest, setManifest] = useState<StreamManifest | null>(null);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number>(() => {
    try {
      const sess = protocolManager.getSession();
      if (sess.activeSegmentIndex !== null && sess.activeSegmentIndex !== undefined && sess.activeSegmentIndex >= 0) {
        return sess.activeSegmentIndex;
      }
      const saved = window.localStorage.getItem('streampay.current-segment.v1');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
      }
    } catch {}
    return 0;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [verifiedMedia, setVerifiedMedia] = useState<Uint8Array | null>(null);
  const [verifiedMediaType, setVerifiedMediaType] = useState('video/mp2t');
  const [verifiedSegments, setVerifiedSegments] = useState<Record<number, { data: Uint8Array; mimeType: string }>>({});
  const inFlightSegments = useRef(new Map<number, Promise<VerificationLog>>());
  const [creatorAddress, setCreatorAddress] = useState(() => {
    return protocolManager.getCreatorState().address || '';
  });
  const [creatorState, setCreatorState] = useState(protocolManager.getCreatorState());

  const updateSegmentIndex = useCallback((index: number) => {
    setCurrentSegmentIndex(index);
    try { window.localStorage.setItem('streampay.current-segment.v1', String(index)); } catch {}
  }, []);

  const updateNav = useCallback((target: 'overview' | 'segments' | 'manifest' | 'payments' | 'session' | 'settings' | 'docs') => {
    setActiveNav(target);
    try { window.localStorage.setItem('streampay.active-nav.v1', target); } catch {}
  }, []);

  // Modals
  const [isOpenSessionModal, setIsOpenSessionModal] = useState(false);
  const [inspectedSegment, setInspectedSegment] = useState<SegmentManifest | null>(null);

  // Sync protocol state
  useEffect(() => {
    const unsubscribe = protocolManager.subscribe(() => {
      setWallet(protocolManager.getWallet());
      setSession(protocolManager.getSession());
      setNetwork(protocolManager.getNetwork());
      setCreatorState(protocolManager.getCreatorState());
    });
    return unsubscribe;
  }, []);

  // Fetch initial health and manifest
  useEffect(() => {
    const init = async () => {
      try {
        const h = await accessService.getHealth();
        setHealth(h);
        if (h.availableStreams && h.availableStreams.length > 0) {
          if (!h.availableStreams.includes(currentStreamId)) {
            const nextStream = h.availableStreams[0];
            setCurrentStreamId(nextStream);
            const m = await accessService.getManifest(nextStream);
            setManifest(m);
            return;
          }
        }
        const m = await accessService.getManifest(currentStreamId);
        setManifest(m);
      } catch (err) {
        setHealth(null);
        console.error('Backend unavailable; no local fallback is enabled:', err);
      }
    };
    init();
  }, [network, currentStreamId]);

  // Handle stream selection
  const handleSelectStream = useCallback(async (streamId: string) => {
    const activeSession = protocolManager.getSession();
    if (activeSession.status !== 'inactive' && activeSession.status !== 'closed') {
      alert('Cannot switch streams while a payment session is active. Close the current session first, then select another stream.');
      return;
    }

    setCurrentStreamId(streamId);
    try { window.localStorage.setItem('streampay.current-stream.v1', streamId); } catch { /* optional */ }
    setIsPlaying(false);
    updateSegmentIndex(0);
    setVerifiedSegments({});
    setVerifiedMedia(null);
    try {
      const m = await accessService.getManifest(streamId);
      setManifest(m);
    } catch (err) {
      setManifest(null);
      console.error('Manifest request failed:', err);
    }
  }, [updateSegmentIndex]);

  const loadVerifiedSegment = useCallback(async (segmentIndex: number): Promise<VerificationLog> => {
    if (!manifest) throw new Error('Stream manifest is unavailable.');
    const cached = verifiedSegments[segmentIndex];
    if (cached) return { mediaData: cached.data, mediaMimeType: cached.mimeType } as VerificationLog;
    const existing = inFlightSegments.current.get(segmentIndex);
    if (existing) return existing;
    const request = protocolManager.requestAndVerifySegment(manifest, segmentIndex);
    inFlightSegments.current.set(segmentIndex, request);
    try {
      const verification = await request;
      if (verification.mediaData) {
        setVerifiedSegments((previous) => ({ ...previous, [segmentIndex]: { data: verification.mediaData!, mimeType: verification.mediaMimeType || 'video/mp2t' } }));
      }
      return verification;
    } finally {
      inFlightSegments.current.delete(segmentIndex);
    }
  }, [manifest, verifiedSegments]);

  // Handle segment playback with serialized cryptographic voucher requests.
  const handlePlaySegment = useCallback(async (segmentIndex: number) => {
    if (!manifest || session.status !== 'active') { setIsOpenSessionModal(true); return; }
    try {
      updateSegmentIndex(segmentIndex);
      const verification = await loadVerifiedSegment(segmentIndex);
      setVerifiedMedia(verification.mediaData || null);
      setVerifiedMediaType(verification.mediaMimeType || 'video/mp2t');
      setIsPlaying(true);
    } catch (err: unknown) {
      setIsPlaying(false);
      console.error('Play segment error:', err);
      alert(err instanceof Error ? err.message : 'Error playing segment');
    }
  }, [session.status, manifest, loadVerifiedSegment]);

  useEffect(() => {
    const nextIndex = currentSegmentIndex + 1;
    if (!manifest || session.status !== 'active' || !verifiedSegments[currentSegmentIndex] || nextIndex >= manifest.totalSegments || verifiedSegments[nextIndex]) return;
    let cancelled = false;
    loadVerifiedSegment(nextIndex).then((verification) => {
      if (cancelled || !verification.mediaData) return;
      setVerifiedSegments((previous) => ({ ...previous, [nextIndex]: { data: verification.mediaData!, mimeType: verification.mediaMimeType || 'video/mp2t' } }));
    }).catch((error) => console.warn('Segment prefetch failed:', error));
    return () => { cancelled = true; };
  }, [currentSegmentIndex, manifest, session.status, verifiedSegments, loadVerifiedSegment]);

  useEffect(() => {
    const current = verifiedSegments[currentSegmentIndex];
    if (!current) return;
    setVerifiedMedia(current.data);
    setVerifiedMediaType(current.mimeType);
  }, [currentSegmentIndex, verifiedSegments]);

  // Session actions
  const handleOpenSessionConfirm = async (deposit: string) => {
    if (!manifest) throw new Error('Manifest is not loaded from the access service.');
    await protocolManager.openPaymentSession(manifest, deposit);
  };

  const handleSignCreatorOffer = async () => {
    if (!manifest) return;
    try { await protocolManager.signCreatorOffer(manifest, creatorAddress); alert('Offer signed. Switch Rabby back to the Payer account, reconnect the wallet, then open the payment session.'); }
    catch (err) { alert(err instanceof Error ? err.message : 'Creator offer signing failed'); }
  };

  const handleSignCreatorClose = async () => {
    try { await protocolManager.signCreatorCloseAuthorization(); alert('Close authorization signed. Switch Rabby back to the Payer account, reconnect, then close the session.'); }
    catch (err) { alert(err instanceof Error ? err.message : 'Creator close signing failed'); }
  };

  const handleUseActiveCreator = async () => {
    try { const address = await protocolManager.getActiveAccount(); setCreatorAddress(address); protocolManager.setCreatorAddress(address); }
    catch (err) { alert(err instanceof Error ? err.message : 'Could not read active Rabby account'); }
  };

  const handleResetCreator = () => { protocolManager.resetCreatorAuthorization(); setCreatorAddress(''); };

  const handleCheckpointSession = async () => {
    try {
      const tx = await protocolManager.checkpointSession();
      alert(tx ? `Checkpoint confirmed on-chain!\nTx Hash: ${tx}` : 'Checkpoint completed in simulation mode. No blockchain transaction was created.');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to checkpoint');
    }
  };

  const handleCloseSession = async () => {
    try {
      const tx = await protocolManager.closeSession();
      setIsPlaying(false);
      alert(tx ? `Session closed cooperatively!\nTx Hash: ${tx}` : 'Session closed in simulation mode. No blockchain transaction was created.');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to close session');
    }
  };

  const handleRefreshClaimable = useCallback(() => { void protocolManager.refreshClaimableRefund().catch((error) => console.warn('Claimable refund lookup failed:', error)); }, []);
  const handleClaimRefund = async () => { try { const tx = await protocolManager.claimRefund(); alert(tx ? `Refund claimed. Tx Hash: ${tx}` : 'Refund claimed in simulation mode.'); } catch (err) { alert(err instanceof Error ? err.message : 'Refund claim failed'); } };

  const handleRefundSession = async () => {
    try {
      const result = await protocolManager.refundSession();
      setIsPlaying(false);
      alert(
        result.tx
          ? `Escrow refund successfully executed on-chain!\nTx Hash: ${result.tx}\n${result.message}`
          : `Escrow refund completed in simulation mode:\n${result.message}`
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Refund failed');
    }
  };

  const handleRefreshManifest = async () => {
    try {
      const m = await accessService.getManifest(currentStreamId);
      setManifest(m);
    } catch (err) {
      setManifest(null);
      console.error('Manifest refresh failed:', err);
    }
  };

  // Switch navigation tabs smoothly
  const handleNavClick = (nav: string) => {
    updateNav(nav as 'overview' | 'segments' | 'manifest' | 'payments' | 'session' | 'settings' | 'docs');
  };

  const handleHeaderTabClick = (tab: 'stream' | 'payments' | 'docs') => {
    if (tab === 'stream') updateNav('overview');
    else if (tab === 'payments') updateNav('payments');
    else if (tab === 'docs') updateNav('docs');
  };

  return (
    <div className="h-screen w-full bg-[#0b0a08] text-neutral-200 flex flex-col overflow-hidden">
      {/* Header Bar */}
      <Header
        activeTab={computedActiveTab}
        setActiveTab={handleHeaderTabClick}
        network={network}
        walletAddress={wallet.address}
        walletBalance={wallet.balanceUSDC}
        isConnected={wallet.isConnected}
        onOpenManifest={() => setIsOpenManifestModal(true)}
      />

      {/* Main 3-Column Layout */}
      <div className="flex-1 flex max-w-[1720px] w-full mx-auto justify-between min-h-0 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          currentStreamId={currentStreamId}
          onSelectStream={handleSelectStream}
          activeNav={activeNav}
          onSelectNav={handleNavClick}
          manifests={{}}
          onOpenManifest={() => setIsOpenManifestModal(true)}
        />

        {/* Center Dynamic Content Area */}
        <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-5 scroll-smooth pb-24">
          {!manifest && activeNav !== 'settings' && activeNav !== 'docs' && (
            <div className="p-8 rounded-2xl border border-red-900/50 bg-red-950/20 text-red-200">
              Waiting for the real Access Service manifest. Start the backend or check the configured URL in Settings.
            </div>
          )}

          {/* 1. Overview: Centerpiece Video Player + Metrics + Segments */}
          {activeNav === 'overview' && manifest && (
            <div className="space-y-6">
              <Player
                manifest={manifest}
                session={session}
                onPlaySegment={handlePlaySegment}
                currentSegmentIndex={currentSegmentIndex}
                setCurrentSegmentIndex={updateSegmentIndex}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
                onOpenSessionRequested={() => setIsOpenSessionModal(true)}
                verifiedMedia={verifiedMedia}
                verifiedMediaType={verifiedMediaType}
              />
              <MetricsGrid manifest={manifest} />
              <SegmentsList
                manifest={manifest}
                session={session}
                currentSegmentIndex={currentSegmentIndex}
                onPlaySegment={handlePlaySegment}
                onRefreshManifest={handleRefreshManifest}
                onInspectProof={(seg) => setInspectedSegment(seg)}
              />
            </div>
          )}

          {/* 2. Segments Explorer: Dedicated Segments View */}
          {activeNav === 'segments' && manifest && (
            <div className="space-y-6">
              <div className="p-5 rounded-2xl bg-[#13100c] border border-[#241d16] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Film className="w-5 h-5 text-[#d89a4e]" />
                    <span>Video Segments Explorer: {manifest.title}</span>
                  </h2>
                  <p className="text-xs text-neutral-400 mt-1">
                    {manifest.totalSegments} segments · {manifest.totalDurationSec}s total duration · {manifest.unitPriceUSDC} USDC/segment · Merkle Root: {manifest.manifestRoot.slice(0, 14)}...
                  </p>
                </div>
                {session.status !== 'active' && (
                  <button
                    onClick={() => setIsOpenSessionModal(true)}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#d89a4e] to-[#b3752c] text-black text-xs font-bold shadow-lg hover:brightness-110 transition-all cursor-pointer whitespace-nowrap"
                  >
                    Open Payment Session
                  </button>
                )}
              </div>
              <SegmentsList
                manifest={manifest}
                session={session}
                currentSegmentIndex={currentSegmentIndex}
                onPlaySegment={handlePlaySegment}
                onRefreshManifest={handleRefreshManifest}
                onInspectProof={(seg) => setInspectedSegment(seg)}
                onOpenManifest={() => setIsOpenManifestModal(true)}
              />
            </div>
          )}

          {/* 3. Manifest View */}
          {activeNav === 'manifest' && manifest && (
            <ManifestView manifest={manifest} />
          )}

          {/* 4. Payments Ledger */}
          {activeNav === 'payments' && (
            <PaymentsView
              session={session}
              wallet={wallet}
              onCheckpoint={handleCheckpointSession}
              onCloseSession={handleCloseSession}
              onClaimRefund={handleClaimRefund}
              onRefundSession={handleRefundSession}
              onRefreshClaimable={handleRefreshClaimable}
              onOpenSession={() => setIsOpenSessionModal(true)}
              onSignCreatorClose={handleSignCreatorClose}
              creatorCloseSigned={creatorState.closeAckSigned}
            />
          )}

          {/* 5. Live Session View */}
          {activeNav === 'session' && (
            <SessionView
              session={session}
              wallet={wallet}
              onOpenSession={() => setIsOpenSessionModal(true)}
              onCheckpoint={handleCheckpointSession}
              onCloseSession={handleCloseSession}
              onClaimRefund={handleClaimRefund}
              onRefundSession={handleRefundSession}
              onRefreshClaimable={handleRefreshClaimable}
              onSignCreatorClose={handleSignCreatorClose}
              creatorCloseSigned={creatorState.closeAckSigned}
            />
          )}

          {/* 6. Settings View */}
          {activeNav === 'settings' && (
            <SettingsView
              network={network}
              onNetworkChange={(net) => protocolManager.setNetwork(net)}
            />
          )}

          {/* 7. Docs View */}
          {activeNav === 'docs' && (
            <DocsView />
          )}
        </main>

        {/* Right Sidebar */}
        <RightSidebar
          wallet={wallet}
          session={session}
          health={health}
          onOpenSession={() => setIsOpenSessionModal(true)}
          onCheckpointSession={handleCheckpointSession}
          onCloseSession={handleCloseSession}
          onRefundSession={handleRefundSession}
          onClaimRefund={handleClaimRefund}
          creatorAddress={creatorAddress}
          onCreatorAddressChange={(value) => { setCreatorAddress(value); protocolManager.setCreatorAddress(value); }}
          onSignCreatorOffer={handleSignCreatorOffer}
          onSignCreatorClose={handleSignCreatorClose}
          onUseActiveCreator={handleUseActiveCreator}
          onResetCreator={handleResetCreator}
          creatorOfferSigned={creatorState.offerSigned}
          creatorCloseSigned={creatorState.closeAckSigned}
        />
      </div>

      {/* Modals */}
      {manifest && <OpenSessionModal
        isOpen={isOpenSessionModal}
        onClose={() => setIsOpenSessionModal(false)}
        manifest={manifest}
        wallet={wallet}
        onConfirmOpen={handleOpenSessionConfirm}
      />}

      {manifest && <ProofInspectorModal
        segment={inspectedSegment}
        manifest={manifest}
        onClose={() => setInspectedSegment(null)}
      />}

      {manifest && <ManifestModal
        isOpen={isOpenManifestModal}
        onClose={() => setIsOpenManifestModal(false)}
        manifest={manifest}
      />}
    </div>
  );
}
