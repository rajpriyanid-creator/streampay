/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { StreamManifest } from '../lib/protocol/manifest';
import { Copy, Check, Download, FileCode2, Binary, Layers, X } from 'lucide-react';

interface ManifestViewProps {
  manifest: StreamManifest;
}

export const ManifestView: React.FC<ManifestViewProps> = ({ manifest }) => {
  const [copied, setCopied] = useState(false);

  const manifestJson = JSON.stringify(manifest, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(manifestJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([manifestJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${manifest.streamId}-manifest.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#1f1912] gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-[#d89a4e]" />
            <span>Stream Manifest: {manifest.title}</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Schema v{manifest.schemaVersion} · {manifest.totalSegments} segments · Root: <span className="font-mono text-[#e8b56f]">{manifest.manifestRoot ? `${manifest.manifestRoot.slice(0, 14)}...` : 'N/A'}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1a140f] hover:bg-[#251c14] border border-[#3b2b1b] text-neutral-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#d89a4e]" />}
            <span>{copied ? 'Copied' : 'Copy JSON'}</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#281d12] hover:bg-[#382718] border border-[#523d24] text-[#e8b56f] text-xs font-semibold transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Highlights Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="p-3.5 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Manifest Merkle Root</div>
          <div className="font-mono text-xs font-bold text-[#e8b56f] mt-1 break-all">
            {manifest.manifestRoot}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Content ID Hash</div>
          <div className="font-mono text-xs font-bold text-neutral-200 mt-1 break-all">
            {manifest.contentIdHash}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Pricing Policy Hash</div>
          <div className="font-mono text-xs font-bold text-neutral-200 mt-1 break-all">
            {manifest.pricingPolicyHash}
          </div>
        </div>
      </div>

      {/* Raw JSON Code Block */}
      <div className="rounded-2xl bg-[#080705] border border-[#241d16] p-4 overflow-hidden">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#1b150f] text-xs text-neutral-400">
          <span className="font-mono">JSON Payload ({manifestJson.length} bytes)</span>
          <span className="font-mono text-[#d89a4e]">application/json</span>
        </div>
        <pre className="font-mono text-xs text-amber-100/90 leading-relaxed overflow-x-auto max-h-[480px]">
          {manifestJson}
        </pre>
      </div>
    </div>
  );
};

interface ManifestModalProps {
  isOpen: boolean;
  onClose: () => void;
  manifest: StreamManifest;
}

export const ManifestModal: React.FC<ManifestModalProps> = ({
  isOpen,
  onClose,
  manifest,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-4xl bg-[#110e0b] border border-[#382b1d] rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#231a12] bg-[#16120d] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#231a12] border border-[#3b2b1c] flex items-center justify-center text-[#d89a4e]">
              <FileCode2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Stream Manifest Inspector</h3>
              <p className="text-[11px] text-neutral-400">Cryptographic Merkle tree & stream metadata</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#231a12] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1">
          <ManifestView manifest={manifest} />
        </div>
      </div>
    </div>
  );
};

