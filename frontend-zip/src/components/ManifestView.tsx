/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { StreamManifest } from '../lib/protocol/manifest';
import { Copy, Check, Download, FileCode2, Binary, Layers } from 'lucide-react';

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
    <div className="p-6 space-y-6">
      {/* Title & Actions */}
      <div className="flex items-center justify-between pb-4 border-b border-[#1f1912]">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-[#d89a4e]" />
            <span>Stream Manifest: {manifest.title}</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Schema v{manifest.schemaVersion} · {manifest.totalSegments} segments · Root Hash: {manifest.manifestRoot.slice(0, 14)}...
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#1a140f] hover:bg-[#251c14] border border-[#3b2b1b] text-neutral-200 text-xs font-semibold transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#d89a4e]" />}
            <span>{copied ? 'Copied' : 'Copy JSON'}</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#281d12] hover:bg-[#382718] border border-[#523d24] text-[#e8b56f] text-xs font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Highlights Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Manifest Merkle Root</div>
          <div className="font-mono text-xs font-bold text-[#e8b56f] mt-1 break-all">
            {manifest.manifestRoot}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
          <div className="text-xs font-medium text-neutral-400">Content ID Hash</div>
          <div className="font-mono text-xs font-bold text-neutral-200 mt-1 break-all">
            {manifest.contentIdHash}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-[#13100c] border border-[#241d16]">
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
        <pre className="font-mono text-xs text-amber-100/90 leading-relaxed overflow-x-auto max-h-[500px]">
          {manifestJson}
        </pre>
      </div>
    </div>
  );
};
