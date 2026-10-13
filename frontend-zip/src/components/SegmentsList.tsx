/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { RotateCcw, Play, CheckCircle2, Loader2, Binary } from 'lucide-react';
import { StreamManifest, SegmentManifest } from '../lib/protocol/manifest';
import { StreamSessionState } from '../lib/protocol/sessionManager';

interface SegmentsListProps {
  manifest: StreamManifest;
  session: StreamSessionState;
  currentSegmentIndex: number;
  onPlaySegment: (index: number) => Promise<void>;
  onRefreshManifest: () => void;
  onInspectProof: (segment: SegmentManifest) => void;
}

// Procedural SVG miniatures depicting the planetary sunrise angles for segments
const SegmentThumbnailSvg: React.FC<{ index: number; isVerified: boolean }> = ({ index, isVerified }) => {
  return (
    <div className="relative w-16 h-10 rounded-lg overflow-hidden shrink-0 border border-[#302316] bg-[#0c0804]">
      <svg viewBox="0 0 160 100" className="w-full h-full object-cover">
        <defs>
          <radialGradient id={`skyGrad-${index}`} cx="70%" cy="25%" r="80%">
            <stop offset="0%" stopColor="#4a260c" />
            <stop offset="40%" stopColor="#1e1005" />
            <stop offset="100%" stopColor="#080402" />
          </radialGradient>
          <radialGradient id={`sunGrad-${index}`} cx="65%" cy="35%" r="30%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="25%" stopColor="#ffc870" />
            <stop offset="60%" stopColor="#e87a20" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Space sky */}
        <rect width="160" height="100" fill={`url(#skyGrad-${index})`} />

        {/* Planet curved horizon */}
        <circle cx={120 + (index * 6)} cy={-20} r="100" fill="#0c0703" stroke="#e8a24c" strokeWidth="2.5" />
        <circle cx={120 + (index * 6)} cy={-20} r="99" fill="none" stroke="#fff1d6" strokeWidth="0.8" opacity="0.8" />

        {/* Solar glow */}
        <circle cx={100 + (index * 4)} cy="32" r="45" fill={`url(#sunGrad-${index})`} />

        {/* Mountain ridge silhouette variation */}
        {index % 2 === 0 ? (
          <polygon
            points="0,65 25,52 45,58 70,48 95,55 125,45 160,56 160,100 0,100"
            fill="#231307"
          />
        ) : (
          <polygon
            points="0,60 35,50 60,56 85,46 115,53 140,48 160,54 160,100 0,100"
            fill="#231307"
          />
        )}

        {/* Foreground crags */}
        <polygon
          points={`0,76 28,68 55,75 85,65 120,72 160,67 160,100 0,100`}
          fill="#140a04"
        />

        {/* Small crater specks */}
        <ellipse cx={40 + (index * 15)} cy="85" rx="10" ry="3" fill="#30180a" opacity="0.6" />
        <ellipse cx={100 - (index * 12)} cy="88" rx="8" ry="2.5" fill="#30180a" opacity="0.6" />
      </svg>

      {/* Verified check badge overlay */}
      {isVerified && (
        <div className="absolute top-1 right-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 drop-shadow" />
        </div>
      )}
    </div>
  );
};

export const SegmentsList: React.FC<SegmentsListProps> = ({
  manifest,
  session,
  currentSegmentIndex,
  onPlaySegment,
  onRefreshManifest,
  onInspectProof,
}) => {
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);

  const handlePlayClick = async (idx: number) => {
    setLoadingIndex(idx);
    try {
      await onPlaySegment(idx);
    } finally {
      setLoadingIndex(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-bold text-white tracking-tight">
          Video Segments
        </h2>

        <button
          onClick={onRefreshManifest}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#14110c] hover:bg-[#1b1611] border border-[#261d15] text-xs font-medium text-neutral-300 transition-colors shadow-sm cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-neutral-400" />
          <span>Refresh Manifest</span>
        </button>
      </div>

      {/* Segments Table/List */}
      <div className="space-y-2">
        {manifest.segments.map((seg, idx) => {
          const isCurrent = currentSegmentIndex === idx;
          const isLoading = loadingIndex === idx;
          const isVerified = session.verificationLogs.some(
            (v) => v.segmentIndex === idx && v.sha256Valid && v.merkleValid
          );

          const sizeKb = (seg.byteLength / 1024).toFixed(1);
          const formattedCost = (Number(seg.costUSDC) >= 1 && !seg.costUSDC.includes('.'))
            ? (Number(seg.costUSDC) / 1_000_000).toFixed(4)
            : seg.costUSDC;

          return (
            <div
              key={idx}
              className={`p-2.5 rounded-xl flex items-center justify-between gap-3 transition-all ${
                isCurrent
                  ? 'bg-[#18130e] border border-[#5d401f] shadow-[0_0_15px_rgba(217,155,77,0.08)]'
                  : 'bg-[#120f0b] border border-[#201811] hover:border-[#332619] hover:bg-[#15110d]'
              }`}
            >
              {/* Left Column: Thumbnail + Index + Details */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Visual Thumbnail */}
                <SegmentThumbnailSvg index={idx} isVerified={isVerified} />

                {/* Segment Index Box */}
                <div className="w-7 h-7 rounded-lg bg-[#18120c] border border-[#291e14] flex items-center justify-center font-bold text-neutral-300 text-xs shrink-0 font-mono">
                  {idx}
                </div>

                {/* Title & Metadata */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
                    <span className="whitespace-nowrap">Segment {idx}</span>
                    {isVerified && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 whitespace-nowrap">
                        Verified
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5 whitespace-nowrap truncate">
                    {seg.durationUnits}s · {sizeKb} KB
                  </div>
                </div>
              </div>

              {/* Right Column: Price + Action Button */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-xs font-medium text-[#e8b56f] font-mono whitespace-nowrap px-2.5 py-1 rounded-lg bg-[#18130e] border border-[#2a2016]">
                  {formattedCost} USDC
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Proof inspect icon */}
                  <button
                    onClick={() => onInspectProof(seg)}
                    className="p-2 rounded-lg text-neutral-400 hover:text-[#e8b56f] hover:bg-[#1c1610] transition-colors cursor-pointer shrink-0"
                    title="Inspect Merkle Proof & SHA-256"
                  >
                    <Binary className="w-4 h-4" />
                  </button>

                  {/* Play Segment Button */}
                  <button
                    onClick={() => handlePlayClick(idx)}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#221a12] hover:bg-[#2c2116] border border-[#433220] hover:border-[#63482b] text-neutral-200 hover:text-white text-xs font-semibold transition-all shadow-sm active:scale-98 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#d89a4e]" />
                    ) : (
                      <Play className="w-3 h-3 fill-current text-[#d89a4e]" />
                    )}
                    <span>Play Segment</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
