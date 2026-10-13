/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Play,
  LayoutDashboard,
  FileCode2,
  Film,
  Receipt,
  KeyRound,
  Settings as SettingsIcon,
} from 'lucide-react';
import { StreamManifest } from '../lib/protocol/manifest';

interface SidebarProps {
  currentStreamId: string;
  onSelectStream: (streamId: string) => void;
  activeNav: string;
  onSelectNav: (nav: string) => void;
  manifests: Record<string, StreamManifest>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentStreamId,
  onSelectStream,
  activeNav,
  onSelectNav,
}) => {
  return (
    <aside className="w-[260px] shrink-0 border-r border-[#1a150f] bg-[#0c0a08] flex flex-col justify-between p-4 select-none min-h-[calc(100vh-64px)]">
      <div className="space-y-6">
        {/* STREAMS Section */}
            <div>
          <div className="text-[10px] font-bold text-[#786b5c] uppercase tracking-widest px-1 mb-2.5">
            STREAMS
          </div>
          <div className="space-y-2">
            {/* Stream 1: Monad Keynote HD (Active in screenshot) */}
            <div
              onClick={() => onSelectStream('monad-keynote-hd')}
              className={`p-2.5 rounded-2xl cursor-pointer transition-all flex items-center gap-3 ${
                currentStreamId === 'monad-keynote-hd'
                  ? 'bg-[#18130e] border border-[#7e5527] shadow-[0_0_15px_rgba(217,155,77,0.12)]'
                  : 'bg-[#120f0c] border border-[#211a13] hover:border-[#382b1d] hover:bg-[#16120e]'
              }`}
            >
              {/* Thumbnail with sci-fi planet & play icon overlay */}
              <div className="relative w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-[#0c0804] border border-[#3b2a1a]">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#1b1108] via-[#3d2410] to-[#7d491c] opacity-90" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-[#e8b56f]">
                    <Play className="w-2.5 h-2.5 fill-current ml-[1px]" />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-white tracking-tight truncate">
                  Monad Keynote HD
                </div>
                <div className="text-[11px] text-[#8a7f72] mt-0.5">
                  5 segments · 10s
                </div>
              </div>
            </div>

            {/* Stream 2: Demo Stream */}
            <div
              onClick={() => onSelectStream('demo-stream')}
              className={`p-2.5 rounded-2xl cursor-pointer transition-all flex items-center gap-3 ${
                currentStreamId === 'demo-stream'
                  ? 'bg-[#18130e] border border-[#7e5527] shadow-[0_0_15px_rgba(217,155,77,0.12)]'
                  : 'bg-[#120f0c] border border-[#211a13] hover:border-[#382b1d] hover:bg-[#16120e]'
              }`}
            >
              <div className="relative w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-neutral-900 border border-[#2a2016]">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#0a111a] via-[#16273b] to-[#274668] opacity-90" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-neutral-400">
                    <Play className="w-2.5 h-2.5 fill-current ml-[1px]" />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-neutral-300 tracking-tight truncate">
                  Demo Stream
                </div>
                <div className="text-[11px] text-[#8a7f72] mt-0.5">
                  8 segments · 16s
                </div>
              </div>
            </div>

            {/* Stream 3: Real Video Test */}
            <div
              onClick={() => onSelectStream('real-demo')}
              className={`p-2.5 rounded-2xl cursor-pointer transition-all flex items-center gap-3 ${
                currentStreamId === 'real-demo'
                  ? 'bg-[#18130e] border border-[#7e5527] shadow-[0_0_15px_rgba(217,155,77,0.12)]'
                  : 'bg-[#120f0c] border border-[#211a13] hover:border-[#382b1d] hover:bg-[#16120e]'
              }`}
            >
              <div className="relative w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-[#102018] border border-[#244b35]">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#0b1d14] via-[#1f5b3b] to-[#80c879] opacity-90" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-[#b8efb2]">
                    <Play className="w-2.5 h-2.5 fill-current ml-[1px]" />
                  </div>
                </div>
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-neutral-300 tracking-tight truncate">Real Video Test</div>
                <div className="text-[11px] text-[#8a7f72] mt-0.5">6 segments · 30s · H.264/AAC</div>
              </div>
            </div>
          </div>
        </div>

        {/* NAVIGATION Section */}
        <div>
          <div className="text-[10px] font-bold text-[#786b5c] uppercase tracking-widest px-1 mb-2.5">
            NAVIGATION
          </div>
          <nav className="space-y-1">
            <button
              onClick={() => onSelectNav('overview')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'overview'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => onSelectNav('manifest')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'manifest'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <FileCode2 className="w-4 h-4" />
              <span>Manifest</span>
            </button>

            <button
              onClick={() => onSelectNav('segments')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'segments'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <Film className="w-4 h-4" />
              <span>Segments</span>
            </button>

            <button
              onClick={() => onSelectNav('payments')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'payments'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <Receipt className="w-4 h-4" />
              <span>Payments</span>
            </button>

            <button
              onClick={() => onSelectNav('session')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'session'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Session</span>
            </button>

            <button
              onClick={() => onSelectNav('settings')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'settings'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <SettingsIcon className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </nav>
        </div>
      </div>

      {/* Bottom Tagline & Golden Wave Curves Graphic */}
      <div className="relative pt-12 pb-2 overflow-hidden">
        {/* Curved golden ribbon lines SVG */}
        <div className="absolute -left-8 top-0 w-72 h-40 opacity-40 pointer-events-none">
          <svg viewBox="0 0 320 160" fill="none" className="w-full h-full">
            <path
              d="M-30,130 C50,120 120,40 270,30"
              stroke="#e8ab56"
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
            <path
              d="M-30,140 C60,130 130,50 290,40"
              stroke="#bc7c31"
              strokeWidth="1"
              strokeOpacity="0.6"
            />
            <path
              d="M-30,150 C70,140 140,60 300,50"
              stroke="#ffd185"
              strokeWidth="0.8"
              strokeOpacity="0.5"
            />
            <path
              d="M-30,120 C40,110 110,30 260,20"
              stroke="#d89a4e"
              strokeWidth="0.6"
              strokeOpacity="0.4"
            />
            <path
              d="M-30,160 C80,150 150,70 310,60"
              stroke="#8f571b"
              strokeWidth="0.8"
              strokeOpacity="0.5"
            />
          </svg>
        </div>

        <div className="relative z-10 space-y-2 px-1">
          <h2 className="text-2xl font-bold tracking-tight text-[#f3ece0] leading-[1.12]">
            Pay <br />
            for what <br />
            you watch.
          </h2>
          <p className="text-xs text-[#8a7f72] leading-relaxed pt-0.5">
            Decentralized video streaming with cryptographic proof.
          </p>
        </div>
      </div>
    </aside>
  );
};
