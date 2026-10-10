/**
 * StreamPay Custom HLS.js Fragment Loader
 * Gates every segment request through the access service.
 * Validates segment integrity (SHA-256 + Merkle proof) before voucher signing.
 *
 * This is NOT a security boundary by itself - the server enforces all entitlements.
 * The client verification adds a trust layer for honest clients.
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

/**
 * Creates a custom fragment loader class for HLS.js.
 * The returned class must be set as `fLoader` in the HLS.js config.
 */
export function createStreamPayFragmentLoader(
  config: StreamPayLoaderConfig
): any {
  // Return a class that implements the HLS.js Loader interface
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

    destroy(): void {
      this.abort();
    }

    abort(): void {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      this.stats.aborted = true;
    }

    load(context: any, _config: any, callbacks: any): void {
      this.context = context;
      this.callbacks = callbacks;
      this.stats.loading.start = performance.now();

      // Check if this is a fragment request
      if (context.frag) {
        this._loadFragment(context, callbacks).catch((err: Error) => {
          if (callbacks.onError) {
            callbacks.onError(
              { code: 0, text: err.message },
              context,
              null,
              this.stats
            );
          }
        });
      } else {
        // Playlist/manifest request - use standard fetch
        this._loadStandard(context, callbacks);
      }
    }

    private async _loadFragment(context: any, callbacks: any): Promise<void> {
      const segmentIndex = context.frag.sn as number;
      this.abortController = new AbortController();

      try {
        // 1. Get access token from access service
        let accessToken = '';
        if (config.onAccessTokenRequest) {
          accessToken = await config.onAccessTokenRequest(segmentIndex);
        }

        // 2. Fetch segment with session-bound headers
        const url = context.url || `${config.accessServiceUrl}/api/segments/${segmentIndex}`;
        const response = await fetch(url, {
          headers: {
            'X-StreamPay-Session': config.sessionId,
            'X-StreamPay-Segment': segmentIndex.toString(),
            'X-StreamPay-Token': accessToken,
          },
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Segment fetch failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.arrayBuffer();
        const bytes = new Uint8Array(data);

        this.stats.loading.first = performance.now();
        this.stats.loaded = data.byteLength;
        this.stats.total = data.byteLength;

        // 3. Verify segment integrity against manifest
        const manifestEntry = config.manifest.segments.find(
          (s) => s.segmentIndex === segmentIndex
        );

        if (manifestEntry) {
          const segmentHash = await hashSegmentBytes(bytes);

          // Verify SHA-256 hash if present
          if (manifestEntry.segmentSha256 && segmentHash.toLowerCase() !== manifestEntry.segmentSha256.toLowerCase()) {
            const reason = 'SEGMENT_HASH_MISMATCH';
            config.onSegmentFailed?.(segmentIndex, reason);
            throw new Error(reason);
          }

          // Verify Merkle proof
          const leaf = computeSegmentLeaf({
            segmentIndex: manifestEntry.segmentIndex,
            contentHash: ((manifestEntry as any).contentHash || config.manifest.contentIdHash) as `0x${string}`,
            cumulativeUnits: BigInt((manifestEntry as any).cumulativeUnits || manifestEntry.durationUnits),
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

          // 4. Segment verified! Notify for voucher signing
          config.onSegmentVerified?.(segmentIndex, manifestEntry.durationUnits);
        }


        this.stats.loading.end = performance.now();

        // 5. Return segment data to HLS.js
        if (callbacks.onSuccess) {
          callbacks.onSuccess(
            { url: context.url, data },
            this.stats,
            context,
            null
          );
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        throw err;
      }
    }

    private _loadStandard(context: any, callbacks: any): void {
      this.abortController = new AbortController();

      fetch(context.url, { signal: this.abortController.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
          }
          const data = await response.arrayBuffer();
          this.stats.loaded = data.byteLength;
          this.stats.total = data.byteLength;
          this.stats.loading.first = performance.now();
          this.stats.loading.end = performance.now();

          if (callbacks.onSuccess) {
            callbacks.onSuccess(
              { url: context.url, data },
              this.stats,
              context,
              null
            );
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          if (callbacks.onError) {
            callbacks.onError(
              { code: 0, text: err.message },
              context,
              null,
              this.stats
            );
          }
        });
    }

    getCacheAge(): number | null {
      return null;
    }

    getResponseHeader(_name: string): string | null {
      return null;
    }
  };
}

/**
 * Get the recommended HLS.js configuration for StreamPay.
 * Buffer limits match the N=3 segment / 12-second window.
 */
export function getStreamPayHlsConfig(loaderClass: any) {
  return {
    fLoader: loaderClass,
    maxBufferLength: 12, // seconds - matches 3 × 4s segments
    maxMaxBufferLength: 24, // hard ceiling
    maxBufferSize: 12 * 1000 * 1000, // 12 MB
    startFragPrefetch: false,
    fragLoadingMaxRetry: 3,
    fragLoadingRetryDelay: 1000,
    fragLoadingMaxRetryTimeout: 64000,
  };
}
