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
    <div className="grid grid-cols-4 gap-3.5 my-5">
      {/* 1. Total Segments */}
      <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center gap-3.5 shadow-sm">
        <div className="w-10 h-10 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
          <Layers className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs font-medium text-neutral-400">Total Segments</div>
          <div className="text-xl font-bold text-white mt-0.5 tracking-tight">
            {manifest.totalSegments}
          </div>
        </div>
      </div>

      {/* 2. Total Duration */}
      <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center gap-3.5 shadow-sm">
        <div className="w-10 h-10 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs font-medium text-neutral-400">Total Duration</div>
          <div className="text-xl font-bold text-white mt-0.5 tracking-tight">
            {manifest.totalDurationSec} sec
          </div>
        </div>
      </div>

      {/* 3. Price per Segment */}
      <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center gap-3.5 shadow-sm">
        <div className="w-10 h-10 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
          <Coins className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs font-medium text-neutral-400">Price per Segment</div>
          <div className="text-xl font-bold text-white mt-0.5 tracking-tight">
            {manifest.unitPriceUSDC} USDC
          </div>
        </div>
      </div>

      {/* 4. Content Hash */}
      <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16] flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3.5 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e] shrink-0">
            <Hash className="w-5 h-5" />
          </div>
          <div className="overflow-hidden">
            <div className="text-xs font-medium text-neutral-400">Content Hash</div>
            <div className="text-sm font-bold font-mono text-white mt-0.5 tracking-tight truncate">
              {truncatedHash}
            </div>
          </div>
        </div>

        <button
          onClick={handleCopyHash}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#1f1812] transition-colors ml-2"
          title="Copy contentIdHash"
        >
          {copiedHash ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};
