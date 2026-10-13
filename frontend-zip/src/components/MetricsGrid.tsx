/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Layers, Clock, Coins, Hash, Copy, Check } from 'lucide-react';
import { StreamManifest } from '../lib/protocol/manifest';

interface MetricsGridProps {
  manifest: StreamManifest;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({ manifest }) => {
  const [copiedHash, setCopiedHash] = useState(false);

  const truncatedHash = manifest.contentIdHash
    ? `${manifest.contentIdHash.slice(0, 6)}...${manifest.contentIdHash.slice(-4)}`
    : '0x3f2a...9c1d';

  const handleCopyHash = () => {
    if (manifest.contentIdHash) {
      navigator.clipboard.writeText(manifest.contentIdHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-4">
      {/* 1. Total Segments */}
      <div className="p-3 sm:p-3.5 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center gap-3 shadow-sm min-w-0">
        <div className="w-9 h-9 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
          <Layers className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-neutral-400 truncate">Total Segments</div>
          <div className="text-base sm:text-lg font-bold text-white mt-0.5 tracking-tight truncate">
            {manifest.totalSegments}
          </div>
        </div>
      </div>

      {/* 2. Total Duration */}
      <div className="p-3 sm:p-3.5 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center gap-3 shadow-sm min-w-0">
        <div className="w-9 h-9 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
          <Clock className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-neutral-400 truncate">Total Duration</div>
          <div className="text-base sm:text-lg font-bold text-white mt-0.5 tracking-tight truncate">
            {manifest.totalDurationSec} <span className="text-xs font-normal text-neutral-400">sec</span>
          </div>
        </div>
      </div>

      {/* 3. Price per Segment */}
      <div className="p-3 sm:p-3.5 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center gap-3 shadow-sm min-w-0">
        <div className="w-9 h-9 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
          <Coins className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-neutral-400 truncate">Price per Segment</div>
          <div className="text-base sm:text-lg font-bold text-white mt-0.5 tracking-tight truncate">
            {manifest.unitPriceUSDC} <span className="text-xs font-semibold text-[#d89a4e]">USDC</span>
          </div>
        </div>
      </div>

      {/* 4. Content Hash */}
      <div className="p-3 sm:p-3.5 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center justify-between gap-2 shadow-sm min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
            <Hash className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-neutral-400 truncate">Content Hash</div>
            <div className="text-xs sm:text-sm font-bold font-mono text-white mt-0.5 tracking-tight truncate" title={manifest.contentIdHash}>
              {truncatedHash}
            </div>
          </div>
        </div>

        <button
          onClick={handleCopyHash}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#1f1812] transition-colors shrink-0 cursor-pointer"
          title="Copy contentIdHash"
        >
          {copiedHash ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
};
