/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FileText, Shield, Code, Cpu, Terminal } from 'lucide-react';

export const DocsView: React.FC = () => {
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="pb-4 border-b border-[#1f1912]">
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <FileText className="w-5 h-5 text-[#d89a4e]" />
          <span>StreamPay Protocol Specification</span>
        </h2>
        <p className="text-xs text-neutral-400 mt-1">
          Pay-per-use video streaming with micro-payment channels, EIP-712 vouchers, and Merkle leaf verification.
        </p>
      </div>

      {/* 9-Step Lifecycle Flow */}
      <div className="p-5 rounded-2xl bg-[#13100c] border border-[#241d16] space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[#d89a4e]" />
          <span>Frontend Playback Lifecycle Flow</span>
        </h3>
        <div className="p-4 rounded-xl bg-[#080705] border border-[#1f1811] font-mono text-xs text-neutral-300 leading-relaxed overflow-x-auto">
{`Load page
  -> GET /health
  -> GET /api/manifest/:streamId
  -> validate manifest
  -> connect wallet or enter simulation mode
  -> approve payment token if necessary
  -> sign ContentOffer
  -> sign SessionConfig
  -> send openWithSignature
  -> derive sessionId
  -> start HLS playback
  -> for each segment:
       sign Voucher(sessionId, cumulativeUnits)
       POST /api/access/segment
       receive single-use segmentToken
       GET gated binary media
       verify SHA-256
       verify Merkle proof
       play segment
  -> send checkpoint transaction
  -> POST /api/session/checkpoint-sync
  -> sign CloseAck
  -> send closeCooperative`}
        </div>
      </div>

      {/* Cryptographic Verification Algorithm */}
      <div className="p-5 rounded-2xl bg-[#13100c] border border-[#241d16] space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#d89a4e]" />
          <span>Segment Merkle Leaf Hashing</span>
        </h3>
        <p className="text-xs text-neutral-400 leading-relaxed">
          Every video segment downloaded must be mathematically validated before rendering to prevent corrupted or tampered media:
        </p>
        <div className="p-4 rounded-xl bg-[#080705] border border-[#1f1811] font-mono text-xs text-neutral-300">
{`// Compute Segment Leaf
leaf = keccak256(
  encodePacked(
    ['uint32', 'uint64', 'bytes32', 'bytes32', 'bytes32'],
    [segmentIndex, durationUnits, contentIdHash, renditionIdHash, segmentSha256]
  )
);

// Verify with Merkle Proof against manifestRoot
verifyMerkleProof(leaf, merkleProof, manifestRoot);`}
        </div>
      </div>

      {/* EIP-712 Domain & Types */}
      <div className="p-5 rounded-2xl bg-[#13100c] border border-[#241d16] space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Code className="w-4 h-4 text-[#d89a4e]" />
          <span>EIP-712 Domain & Types</span>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-xl bg-[#080705] border border-[#1f1811]">
            <div className="text-xs font-semibold text-[#e8b56f] mb-1">Domain</div>
            <pre className="font-mono text-[11px] text-neutral-300">
{`{
  name: "StreamPaySettlement",
  version: "2.5",
  chainId: 10143 | 31337,
  verifyingContract: "0x..."
}`}
            </pre>
          </div>

          <div className="p-3 rounded-xl bg-[#080705] border border-[#1f1811]">
            <div className="text-xs font-semibold text-[#e8b56f] mb-1">Voucher Type</div>
            <pre className="font-mono text-[11px] text-neutral-300">
{`Voucher: [
  { name: 'sessionId', type: 'bytes32' },
  { name: 'cumulativeUnits', type: 'uint64' }
]`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
