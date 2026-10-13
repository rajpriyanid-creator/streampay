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
  onOpenManifest?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentStreamId,
  onSelectStream,
  activeNav,
  onSelectNav,
  onOpenManifest,
}) => {
  return (
    <aside className="w-[240px] xl:w-[260px] shrink-0 border-r border-[#1a150f] bg-[#0c0a08] flex flex-col p-3 sm:p-3.5 select-none h-full overflow-hidden">
      {/* Scrollable Top Section: Streams + Nav Items */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-3.5 pr-0.5">
        {/* STREAMS Section */}
        <div>
          <div className="text-[10px] font-bold text-[#786b5c] uppercase tracking-widest px-1 mb-2">
            STREAMS
          </div>
          <div className="space-y-1.5">
            {/* Stream 1: Monad Keynote HD */}
            <div
              onClick={() => onSelectStream('monad-keynote-hd')}
              className={`p-2 rounded-xl cursor-pointer transition-all flex items-center gap-2.5 ${
                currentStreamId === 'monad-keynote-hd'
                  ? 'bg-[#18130e] border border-[#7e5527] shadow-[0_0_15px_rgba(217,155,77,0.12)]'
                  : 'bg-[#120f0c] border border-[#211a13] hover:border-[#382b1d] hover:bg-[#16120e]'
              }`}
            >
              {/* Thumbnail */}
              <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-[#0c0804] border border-[#3b2a1a]">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#1b1108] via-[#3d2410] to-[#7d491c] opacity-90" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-[#e8b56f]">
                    <Play className="w-2 h-2 fill-current ml-[1px]" />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden min-w-0 flex-1">
                <div className="text-xs font-semibold text-white tracking-tight truncate">
                  Monad Keynote HD
                </div>
                <div className="text-[10px] text-[#8a7f72] mt-0.5 truncate">
                  5 segments · 10s
                </div>
              </div>
            </div>

            {/* Stream 2: Demo Stream */}
            <div
              onClick={() => onSelectStream('demo-stream')}
              className={`p-2 rounded-xl cursor-pointer transition-all flex items-center gap-2.5 ${
                currentStreamId === 'demo-stream'
                  ? 'bg-[#18130e] border border-[#7e5527] shadow-[0_0_15px_rgba(217,155,77,0.12)]'
                  : 'bg-[#120f0c] border border-[#211a13] hover:border-[#382b1d] hover:bg-[#16120e]'
              }`}
            >
              <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-neutral-900 border border-[#2a2016]">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#0a111a] via-[#16273b] to-[#274668] opacity-90" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-neutral-400">
                    <Play className="w-2 h-2 fill-current ml-[1px]" />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden min-w-0 flex-1">
                <div className="text-xs font-semibold text-neutral-300 tracking-tight truncate">
                  Demo Stream
                </div>
                <div className="text-[10px] text-[#8a7f72] mt-0.5 truncate">
                  8 segments · 16s
                </div>
              </div>
            </div>

            {/* Stream 3: Real Video Test */}
            <div
              onClick={() => onSelectStream('real-demo')}
              className={`p-2 rounded-xl cursor-pointer transition-all flex items-center gap-2.5 ${
                currentStreamId === 'real-demo'
                  ? 'bg-[#18130e] border border-[#7e5527] shadow-[0_0_15px_rgba(217,155,77,0.12)]'
                  : 'bg-[#120f0c] border border-[#211a13] hover:border-[#382b1d] hover:bg-[#16120e]'
              }`}
            >
              <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-[#102018] border border-[#244b35]">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#0b1d14] via-[#1f5b3b] to-[#80c879] opacity-90" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-[#b8efb2]">
                    <Play className="w-2 h-2 fill-current ml-[1px]" />
                  </div>
                </div>
              </div>
              <div className="overflow-hidden min-w-0 flex-1">
                <div className="text-xs font-semibold text-neutral-300 tracking-tight truncate">Real Video Test</div>
                <div className="text-[10px] text-[#8a7f72] mt-0.5 truncate">6 segments · 30s · H.264/AAC</div>
              </div>
            </div>
          </div>
        </div>

        {/* NAVIGATION Section */}
        <div>
          <div className="text-[10px] font-bold text-[#786b5c] uppercase tracking-widest px-1 mb-2">
            NAVIGATION
          </div>
          <nav className="space-y-1">
            <button
              onClick={() => onSelectNav('overview')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'overview'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => onSelectNav('segments')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
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
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
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
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
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
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeNav === 'settings'
                  ? 'bg-[#261c12] text-[#e8ab56] border border-[#44311f] font-semibold shadow-[0_0_12px_rgba(217,155,77,0.12)]'
                  : 'text-[#8e8172] hover:text-neutral-200 hover:bg-[#15110d]'
              }`}
            >
              <SettingsIcon className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </nav>

          {/* Small Secondary Manifest Button in Sidebar */}
          {onOpenManifest && (
            <div className="pt-2 border-t border-[#1e1710]/80 mt-2">
              <button
                onClick={onOpenManifest}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#7d7062] hover:text-[#e8ab56] hover:bg-[#14100c] transition-all cursor-pointer group"
                title="Inspect Stream Manifest JSON & Merkle Tree"
              >
                <FileCode2 className="w-3.5 h-3.5 text-[#d89a4e]/70 group-hover:text-[#d89a4e]" />
                <span>Inspect Manifest</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Tagline & Golden Wave Curves Graphic - pinned shrink-0 mt-auto */}
      <div className="relative shrink-0 mt-auto pt-3 pb-1 border-t border-[#1c1610] overflow-hidden">
        {/* Curved golden ribbon lines SVG */}
        <div className="absolute -left-6 -top-2 w-64 h-24 opacity-35 pointer-events-none">
          <svg viewBox="0 0 320 120" fill="none" className="w-full h-full">
            <path
              d="M-30,100 C50,90 120,30 270,20"
              stroke="#e8ab56"
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
            <path
              d="M-30,110 C60,100 130,40 290,30"
              stroke="#bc7c31"
              strokeWidth="1"
              strokeOpacity="0.6"
            />
            <path
              d="M-30,120 C70,110 140,50 300,40"
              stroke="#ffd185"
              strokeWidth="0.8"
              strokeOpacity="0.5"
            />
            <path
              d="M-30,90 C40,80 110,20 260,12"
              stroke="#d89a4e"
              strokeWidth="0.6"
              strokeOpacity="0.4"
            />
            <path
              d="M-30,130 C80,120 150,60 310,50"
              stroke="#8f571b"
              strokeWidth="0.8"
              strokeOpacity="0.5"
            />
          </svg>
        </div>

        <div className="relative z-10 px-1 py-0.5">
          <h2 className="text-sm xl:text-base font-bold tracking-tight text-[#f3ece0] leading-snug">
            Pay for what you watch.
          </h2>
          <p className="text-[11px] text-[#8a7f72] leading-snug mt-1">
            Decentralized video streaming with cryptographic proof.
          </p>
        </div>
      </div>
    </aside>
  );
};
