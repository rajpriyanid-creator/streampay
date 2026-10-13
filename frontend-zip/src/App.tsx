/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { ManifestView } from './components/ManifestView';
import { PaymentsView } from './components/PaymentsView';
import { DocsView } from './components/DocsView';
import { SettingsView } from './components/SettingsView';

import {
  protocolManager,
  WalletState,
  StreamSessionState,
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
  const [activeTab, setActiveTab] = useState<'stream' | 'manifest' | 'payments' | 'docs'>('stream');
  const [activeNav, setActiveNav] = useState('overview');
  const [currentStreamId, setCurrentStreamId] = useState('monad-keynote-hd');
  const [manifest, setManifest] = useState<StreamManifest | null>(null);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [verifiedMedia, setVerifiedMedia] = useState<Uint8Array | null>(null);
  const [creatorAddress, setCreatorAddress] = useState('');
  const [creatorState, setCreatorState] = useState(protocolManager.getCreatorState());

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
    setCurrentStreamId(streamId);
    setIsPlaying(false);
    setCurrentSegmentIndex(0);
    try {
      const m = await accessService.getManifest(streamId);
      setManifest(m);
    } catch (err) {
      setManifest(null);
      console.error('Manifest request failed:', err);
    }
  }, []);

  // Handle segment playback with cryptographic voucher request & verification
  const handlePlaySegment = useCallback(
    async (segmentIndex: number) => {
      if (!manifest || session.status !== 'active') {
        setIsOpenSessionModal(true);
        return;
      }

      try {
        setCurrentSegmentIndex(segmentIndex);
        const verification = await protocolManager.requestAndVerifySegment(manifest, segmentIndex);
        setVerifiedMedia(verification.mediaData || null);
        setIsPlaying(true);
      } catch (err: unknown) {
        console.error('Play segment error:', err);
        alert(err instanceof Error ? err.message : 'Error playing segment');
      }
    },
    [session.status, manifest]
  );

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
    setActiveNav(nav);
    if (nav === 'overview') setActiveTab('stream');
    else if (nav === 'manifest') setActiveTab('manifest');
    else if (nav === 'payments' || nav === 'session') setActiveTab('payments');
  };

  return (
    <div className="min-h-screen bg-[#0b0a08] text-neutral-200 flex flex-col">
      {/* Header Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'stream') setActiveNav('overview');
          else if (tab === 'manifest') setActiveNav('manifest');
          else if (tab === 'payments') setActiveNav('payments');
        }}
        network={network}
        walletAddress={wallet.address}
        walletBalance={wallet.balanceUSDC}
        isConnected={wallet.isConnected}
      />

      {/* Main 3-Column Layout */}
      <div className="flex-1 flex max-w-[1640px] w-full mx-auto justify-between">
        {/* Left Sidebar */}
        <Sidebar
          currentStreamId={currentStreamId}
          onSelectStream={handleSelectStream}
          activeNav={activeNav}
          onSelectNav={handleNavClick}
           manifests={{}}
        />

        {/* Center Dynamic Content Area */}
        <main className="flex-1 min-w-0 px-6 py-4 overflow-y-auto">
          {!manifest && (
            <div className="p-8 rounded-2xl border border-red-900/50 bg-red-950/20 text-red-200">
              Waiting for the real Access Service manifest. Start the backend or check the configured URL in Settings.
            </div>
          )}

          {manifest && activeTab === 'stream' && activeNav === 'overview' && (
            <div className="space-y-6">
              {/* Centerpiece Cinematic Video Player */}
              <Player
                manifest={manifest}
                session={session}
                onPlaySegment={handlePlaySegment}
                currentSegmentIndex={currentSegmentIndex}
                setCurrentSegmentIndex={setCurrentSegmentIndex}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
                onOpenSessionRequested={() => setIsOpenSessionModal(true)}
                verifiedMedia={verifiedMedia}
              />

              {/* 4 Metrics Cards Row */}
              <MetricsGrid manifest={manifest} />

              {/* Video Segments Table */}
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

          {manifest && activeTab === 'manifest' && (
            <ManifestView manifest={manifest} />
          )}

          {activeTab === 'payments' && (
            <PaymentsView
              session={session}
              wallet={wallet}
              onCheckpoint={handleCheckpointSession}
              onCloseSession={handleCloseSession}
            />
          )}

          {activeTab === 'docs' && (
            <DocsView />
          )}

          {activeNav === 'settings' && (
            <SettingsView
              network={network}
              onNetworkChange={(net) => protocolManager.setNetwork(net)}
            />
          )}

          {manifest && activeNav === 'segments' && activeTab === 'stream' && (
            <div className="space-y-6">
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
        </main>

        {/* Right Sidebar */}
        <RightSidebar
          wallet={wallet}
          session={session}
          health={health}
          onOpenSession={() => setIsOpenSessionModal(true)}
          onCheckpointSession={handleCheckpointSession}
          onCloseSession={handleCloseSession}
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
    </div>
  );
}
