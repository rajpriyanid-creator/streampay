/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Settings as SettingsIcon, Server, Globe, Shield, RefreshCw, CheckCircle2 } from 'lucide-react';
import { protocolManager, NetworkType } from '../lib/protocol/sessionManager';
import { accessService } from '../lib/protocol/accessClient';

interface SettingsViewProps {
  network: NetworkType;
  onNetworkChange: (net: NetworkType) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  network,
  onNetworkChange,
}) => {
  const [accessUrl, setAccessUrl] = useState(accessService.getBaseUrl());
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleTestBackend = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      accessService.setBaseUrl(accessUrl);
      const health = await accessService.getHealth();
      setTestResult(`Backend is responsive! Status: ${health.status}, Mode: ${health.mode}`);
    } catch {
      setTestResult('Backend unreachable at this URL. No fallback is enabled; fix the URL or start the access service.');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="pb-4 border-b border-[#1f1912]">
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-[#d89a4e]" />
          <span>StreamPay Configuration & Network</span>
        </h2>
        <p className="text-xs text-neutral-400 mt-1">
          Configure blockchain RPCs, Access Service endpoints, and operational modes.
        </p>
      </div>

      {/* Network Mode */}
      <div className="p-5 rounded-2xl bg-[#13100c] border border-[#241d16] space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Globe className="w-4 h-4 text-[#d89a4e]" />
          <span>Active Network Environment</span>
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => onNetworkChange('local')}
            className={`p-4 rounded-xl text-left border transition-all ${
              network === 'local'
                ? 'bg-[#1e1710] border-[#d89a4e] shadow-[0_0_15px_rgba(216,154,78,0.15)]'
                : 'bg-[#0a0806] border-[#221a13] hover:border-[#382b1d]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-white text-sm">Local Anvil</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                Chain 31337
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Local test RPC (http://127.0.0.1:8545) with deterministic local test provider.
            </p>
          </button>

          <button
            onClick={() => onNetworkChange('testnet')}
            className={`p-4 rounded-xl text-left border transition-all ${
              network === 'testnet'
                ? 'bg-[#1e1710] border-[#d89a4e] shadow-[0_0_15px_rgba(216,154,78,0.15)]'
                : 'bg-[#0a0806] border-[#221a13] hover:border-[#382b1d]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-white text-sm">Monad Testnet</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-400 border border-purple-800/40">
                Chain 10143
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Live testnet with Monad RPC (https://testnet-rpc.monad.xyz) & deployed settlement.
            </p>
          </button>
        </div>
      </div>

      {/* Access Service URL */}
      <div className="p-5 rounded-2xl bg-[#13100c] border border-[#241d16] space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Server className="w-4 h-4 text-[#d89a4e]" />
          <span>Access Service URL</span>
        </h3>

        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={accessUrl}
              onChange={(e) => setAccessUrl(e.target.value)}
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#0a0806] border border-[#261e16] text-white text-xs font-mono focus:border-[#d89a4e] focus:outline-none"
              placeholder="http://localhost:4001"
            />
            <button
              onClick={handleTestBackend}
              disabled={isTesting}
              className="px-4 py-2.5 rounded-xl bg-[#241a12] hover:bg-[#322318] border border-[#4d3620] text-[#e8b56f] text-xs font-semibold flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              <span>Test Connection</span>
            </button>
          </div>

          {testResult && (
            <div className="p-3 rounded-xl bg-[#0b0907] border border-[#201912] text-xs text-neutral-300">
              {testResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
