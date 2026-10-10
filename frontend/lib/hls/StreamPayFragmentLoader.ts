/**
 * StreamPay Custom HLS.js Fragment Loader
 * Gates every segment request through the access service.
 * Validates segment integrity (SHA-256 + Merkle proof) before voucher signing.
 *
 * Standardized to canonical StreamPaySegmentLeaf struct hashing.
 */

import type Hls from 'hls.js';
import type { SegmentManifest } from '../protocol/typedData';
import { hashSegmentBytes, computeSegmentLeaf, verifyMerkleProof } from '../protocol/manifest';

export interface StreamPayLoaderConfig {
  sessionId: string;
  accessServiceUrl: string;
  manifest: SegmentManifest;
  onSegmentVerified?: (segmentIndex: number, durationUnits: number) => void;
  onSegmentFailed?: (segmentIndex: number, reason: string) => void;
  onAccessTokenRequest?: (segmentIndex: number) => Promise<string>;
}

export function createStreamPayFragmentLoader(
  config: StreamPayLoaderConfig
): any {
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
      const segmentIndex = match ? parseInt(match[1], 10) : 0;

      // 1. Obtain single-use access token
      let token = '';
      if (config.onAccessTokenRequest) {
        token = await config.onAccessTokenRequest(segmentIndex);
      }

      // 2. Build gated content URL
      const fetchUrl = token
        ? `${config.accessServiceUrl}/api/access/content/monad-keynote-hd/segment_${segmentIndex}.ts?token=${token}`
        : url;

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

      // 4. Verify segment integrity (SHA-256 + Canonical Merkle Proof)
      if (config.manifest && config.manifest.segments) {
        const manifestEntry = config.manifest.segments.find(
          (s) => s.segmentIndex === segmentIndex
        );

        if (manifestEntry) {
          const segmentHash = await hashSegmentBytes(bytes);

          // Verify SHA-256 hash
          if (manifestEntry.segmentSha256 && segmentHash.toLowerCase() !== manifestEntry.segmentSha256.toLowerCase()) {
            const reason = 'SEGMENT_HASH_MISMATCH';
            config.onSegmentFailed?.(segmentIndex, reason);
            throw new Error(reason);
          }

          // Verify Canonical Merkle proof using StreamPaySegmentLeaf
          const leaf = computeSegmentLeaf({
            contentIdHash: config.manifest.contentIdHash as `0x${string}`,
            segmentIndex: manifestEntry.segmentIndex,
            durationUnits: manifestEntry.durationUnits,
            segmentSha256: (manifestEntry.segmentSha256 || segmentHash) as `0x${string}`,
          });

          const proofValid = verifyMerkleProof(
            leaf,
            (manifestEntry.merkleProof || []) as `0x${string}`[],
            config.manifest.manifestRoot as `0x${string}`
          );

          if (!proofValid) {
            const reason = 'MERKLE_PROOF_INVALID';
            config.onSegmentFailed?.(segmentIndex, reason);
            throw new Error(reason);
          }

          config.onSegmentVerified?.(segmentIndex, manifestEntry.durationUnits);
        }
      }

      this.stats.loading.end = performance.now();

      // 5. Deliver segment bytes to HLS.js
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
