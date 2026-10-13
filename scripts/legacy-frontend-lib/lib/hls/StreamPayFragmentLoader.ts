/**
 * StreamPay Custom HLS.js Fragment Loader
 * Gates every segment request through the access service.
 * Enforces fail-closed token acquisition, binary payload fetch,
 * and cryptographic validation (SHA-256 + Canonical Merkle Proof) before delivery and billing.
 *
 * Standardized to canonical StreamPaySegmentLeaf struct hashing.
 */

import type Hls from 'hls.js';
import type { SegmentManifest, SegmentManifestEntry } from '../protocol/typedData';
import { hashSegmentBytes, computeSegmentLeaf, verifyMerkleProof } from '../protocol/manifest';

export interface StreamPayLoaderConfig {
  sessionId: string;
  streamId?: string;
  accessServiceUrl: string;
  manifest: SegmentManifest;
  onSegmentVerified?: (segmentIndex: number, durationUnits: number) => void;
  onSegmentFailed?: (segmentIndex: number, reason: string) => void;
  onAccessTokenRequest?: (segmentIndex: number) => Promise<string>;
}

export function createStreamPayFragmentLoader(
  config: StreamPayLoaderConfig
): any {
  // Per-stream/session cache of cryptographically verified segment buffers.
  // Prevents HLS preload/retry from re-requesting tokens or generating duplicate vouchers.
  const verifiedSegmentCache = new Map<number, { data: ArrayBuffer; stats: any }>();

  return class StreamPayFragmentLoader {
    private context: any = null;
    private callbacks: any = null;
    private abortController: AbortController | null = null;
    private stats: any;

    constructor(hlsConfig: any) {
      this.stats = {
        aborted: false,
        loaded: 0,
        retry: 0,
        total: 0,
        chunkCount: 0,
        bwEstimate: 0,
        loading: { start: 0, first: 0, end: 0 },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, first: 0, end: 0 },
      };
    }

    load(context: any, hlsConfig: any, callbacks: any): void {
      this.context = context;
      this.callbacks = callbacks;
      this.abortController = new AbortController();
      this.stats.loading.start = performance.now();

      this.executeGatedLoad(context, callbacks).catch((err) => {
        if (!this.stats.aborted) {
          callbacks.onError(
            { code: 403, text: err.message },
            context,
            null
          );
        }
      });
    }

    private async executeGatedLoad(context: any, callbacks: any): Promise<void> {
      const url: string = context.url;
      const match = url.match(/segment[_-](\d+)/i) || url.match(/(\d+)\.ts$/);
      if (!match) {
        throw new Error(`FAIL_CLOSED: Cannot determine segment index from url: ${url}`);
      }
      const segmentIndex = parseInt(match[1], 10);

      // Check verified cache to prevent double-charging or duplicate vouchers on player preload/retry
      if (verifiedSegmentCache.has(segmentIndex)) {
        const cached = verifiedSegmentCache.get(segmentIndex)!;
        this.stats.loaded = cached.data.byteLength;
        this.stats.total = cached.data.byteLength;
        this.stats.loading.end = performance.now();
        callbacks.onSuccess(
          {
            url: context.url,
            data: cached.data,
          },
          this.stats,
          context
        );
        return;
      }

      // Determine streamId dynamically — fail-closed if missing
      const streamId = config.streamId || config.manifest?.streamId;
      if (!streamId) {
        throw new Error('FAIL_CLOSED: Missing streamId in StreamPay loader configuration');
      }

      // Fail-closed validation of manifest entry and Merkle proof
      if (!config.manifest || !Array.isArray(config.manifest.segments)) {
        throw new Error('FAIL_CLOSED: Segment manifest missing or invalid');
      }

      const manifestEntry = config.manifest.segments.find(
        (s) => s.segmentIndex === segmentIndex
      );

      if (!manifestEntry) {
        const reason = `FAIL_CLOSED: Missing manifest entry for segment ${segmentIndex}`;
        config.onSegmentFailed?.(segmentIndex, reason);
        throw new Error(reason);
      }

      if (!manifestEntry.merkleProof || !Array.isArray(manifestEntry.merkleProof) || manifestEntry.merkleProof.length === 0) {
        const reason = `FAIL_CLOSED: Missing or empty Merkle proof for segment ${segmentIndex}`;
        config.onSegmentFailed?.(segmentIndex, reason);
        throw new Error(reason);
      }

      // 1. Obtain single-use access token — fail closed if not provided
      if (!config.onAccessTokenRequest) {
        throw new Error('FAIL_CLOSED: onAccessTokenRequest handler not configured');
      }

      const token = await config.onAccessTokenRequest(segmentIndex);
      if (!token || typeof token !== 'string' || token.trim() === '') {
        const reason = `FAIL_CLOSED: Access token required for segment ${segmentIndex}`;
        config.onSegmentFailed?.(segmentIndex, reason);
        throw new Error(reason);
      }

      // 2. Build gated content URL bound to streamId and segment
      const fetchUrl = `${config.accessServiceUrl}/api/access/content/${encodeURIComponent(streamId)}/segment_${segmentIndex}.ts?token=${encodeURIComponent(token)}`;

      // 3. Fetch binary segment bytes
      const response = await fetch(fetchUrl, {
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`Segment fetch failed with HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      this.stats.loaded = bytes.byteLength;
      this.stats.total = bytes.byteLength;
      this.stats.loading.first = performance.now();

      // 4. Strict cryptographic verification (SHA-256 + Canonical Merkle Proof)
      // A plain HTTP 200 is explicitly insufficient.
      const segmentHash = await hashSegmentBytes(bytes);

      if (manifestEntry.segmentSha256 && segmentHash.toLowerCase() !== manifestEntry.segmentSha256.toLowerCase()) {
        const reason = `SEGMENT_HASH_MISMATCH: expected ${manifestEntry.segmentSha256}, got ${segmentHash}`;
        config.onSegmentFailed?.(segmentIndex, reason);
        throw new Error(reason);
      }

      const manifestRoot = (config.manifest.manifestRoot || config.manifest.merkleRoot) as `0x${string}`;
      if (!manifestRoot) {
        const reason = 'FAIL_CLOSED: Missing manifest root in configuration';
        config.onSegmentFailed?.(segmentIndex, reason);
        throw new Error(reason);
      }

      const leaf = computeSegmentLeaf({
        contentIdHash: config.manifest.contentIdHash as `0x${string}`,
        segmentIndex: manifestEntry.segmentIndex,
        durationUnits: manifestEntry.durationUnits,
        renditionIdHash: (manifestEntry.renditionIdHash || ('0x' + '00'.repeat(32))) as `0x${string}`,
        segmentSha256: manifestEntry.segmentSha256 as `0x${string}`,
      });

      const proofValid = verifyMerkleProof(
        leaf,
        manifestEntry.merkleProof as `0x${string}`[],
        manifestRoot
      );

      if (!proofValid) {
        const reason = `MERKLE_PROOF_INVALID: Leaf ${leaf} failed verification against root ${manifestRoot}`;
        config.onSegmentFailed?.(segmentIndex, reason);
        throw new Error(reason);
      }

      // 5. Bill only AFTER successful verification of exact bytes and proof
      config.onSegmentVerified?.(segmentIndex, manifestEntry.durationUnits);

      this.stats.loading.end = performance.now();
      verifiedSegmentCache.set(segmentIndex, { data: buffer, stats: { ...this.stats } });

      // 6. Deliver verified segment bytes to HLS.js pipeline
      callbacks.onSuccess(
        {
          url: fetchUrl,
          data: buffer,
        },
        this.stats,
        context
      );
    }

    abort(): void {
      this.stats.aborted = true;
      if (this.abortController) {
        this.abortController.abort();
      }
    }

    destroy(): void {
      this.abort();
      this.context = null;
      this.callbacks = null;
    }
  };
}
