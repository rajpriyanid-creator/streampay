/**
 * Fragment Loader Injection & Cryptographic Corruption Test
 * Directly tests StreamPayFragmentLoader under real network byte mutation
 * and proof tampering:
 * 1. Proves that mutated/corrupted media bytes suppress billing callbacks and HLS delivery.
 * 2. Proves that tampered Merkle proof siblings suppress billing callbacks and HLS delivery.
 * 3. Proves that authentic media bytes with valid Merkle proofs succeed and trigger billing.
 *
 * Usage: npx tsx scripts/e2e/fragment-loader-corruption.test.ts
 */

import fs from 'fs';
import path from 'path';
import { type Hex } from 'viem';
import { createStreamPayFragmentLoader } from '../legacy-frontend-lib/lib/hls/StreamPayFragmentLoader';

async function main() {
  console.log('\n🛡️  Starting StreamPay Fragment Loader Injected Corruption Test Suite...\n');

  // Load canonical manifest and real segment bytes
  const manifestPath = path.join(__dirname, '../../manifests/demo_stream.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const seg0Path = path.join(__dirname, '../../fixtures/media/segment_0.ts');
  const authenticBytes = fs.readFileSync(seg0Path);

  const mockAccessToken = 'token_test_abc123.sig_xyz';
  const accessServiceUrl = 'http://localhost:4001';

  // ─── Test 1: Injected Mutated Bytes (Flipped Bit/Byte) ─────────────
  console.log('Test 1: Mutating served binary bytes in transit (corruption injection)...');
  {
    const corruptedBytes = Buffer.from(authenticBytes);
    // Corrupt byte at offset 42
    corruptedBytes[42] = corruptedBytes[42] ^ 0xff;

    let verifiedCalled = false;
    let failedReason = '';
    let successCalled = false;
    let errorCalled = false;

    // Mock global fetch to return corrupted media bytes
    const originalFetch = global.fetch;
    global.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/content/')) {
        return new Response(corruptedBytes, {
          status: 200,
          headers: { 'Content-Type': 'video/mp2t' },
        });
      }
      return originalFetch(input);
    };

    try {
      const LoaderClass = createStreamPayFragmentLoader({
        sessionId: '0x' + '11'.repeat(32),
        streamId: manifest.streamId,
        accessServiceUrl,
        manifest,
        onAccessTokenRequest: async () => mockAccessToken,
        onSegmentVerified: () => {
          verifiedCalled = true;
        },
        onSegmentFailed: (_idx, reason) => {
          failedReason = reason;
        },
      });

      const loader = new LoaderClass({});
      const context = { url: `/api/access/content/${manifest.streamId}/segment_0.ts` };
      const callbacks = {
        onSuccess: () => {
          successCalled = true;
        },
        onError: () => {
          errorCalled = true;
        },
      };

      await new Promise<void>((resolve) => {
        const origOnError = callbacks.onError;
        callbacks.onError = () => {
          origOnError();
          resolve();
        };
        const origOnSuccess = callbacks.onSuccess;
        callbacks.onSuccess = () => {
          origOnSuccess();
          resolve();
        };

        loader.load(context, {}, callbacks);
      });

      if (verifiedCalled) {
        throw new Error('SECURITY VIOLATION: onSegmentVerified called for corrupted bytes!');
      }
      if (successCalled) {
        throw new Error('SECURITY VIOLATION: callbacks.onSuccess called for corrupted bytes!');
      }
      if (!errorCalled) {
        throw new Error('Expected callbacks.onError to be called');
      }
      if (!failedReason.includes('SEGMENT_HASH_MISMATCH')) {
        throw new Error(`Expected SEGMENT_HASH_MISMATCH reason, got: ${failedReason}`);
      }
      console.log('  ✅ Injected byte corruption successfully detected and suppressed:');
      console.log(`     Reason: ${failedReason}`);
      console.log('     Billing callback: SUPPRESSED');
      console.log('     HLS pipeline delivery: SUPPRESSED');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // ─── Test 2: Injected Tampered Merkle Proof Sibling ───────────────
  console.log('\nTest 2: Tampering Merkle proof sibling in manifest...');
  {
    const tamperedManifest = JSON.parse(JSON.stringify(manifest));
    tamperedManifest.segments[0].merkleProof[0] = ('0x' + 'ff'.repeat(32)) as Hex;

    let verifiedCalled = false;
    let failedReason = '';
    let successCalled = false;
    let errorCalled = false;

    const originalFetch = global.fetch;
    global.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/content/')) {
        return new Response(authenticBytes, {
          status: 200,
          headers: { 'Content-Type': 'video/mp2t' },
        });
      }
      return originalFetch(input);
    };

    try {
      const LoaderClass = createStreamPayFragmentLoader({
        sessionId: '0x' + '22'.repeat(32),
        streamId: manifest.streamId,
        accessServiceUrl,
        manifest: tamperedManifest,
        onAccessTokenRequest: async () => mockAccessToken,
        onSegmentVerified: () => {
          verifiedCalled = true;
        },
        onSegmentFailed: (_idx, reason) => {
          failedReason = reason;
        },
      });

      const loader = new LoaderClass({});
      const context = { url: `/api/access/content/${manifest.streamId}/segment_0.ts` };
      const callbacks = {
        onSuccess: () => {
          successCalled = true;
        },
        onError: () => {
          errorCalled = true;
        },
      };

      await new Promise<void>((resolve) => {
        const origOnError = callbacks.onError;
        callbacks.onError = () => {
          origOnError();
          resolve();
        };
        const origOnSuccess = callbacks.onSuccess;
        callbacks.onSuccess = () => {
          origOnSuccess();
          resolve();
        };

        loader.load(context, {}, callbacks);
      });

      if (verifiedCalled) {
        throw new Error('SECURITY VIOLATION: onSegmentVerified called for tampered proof!');
      }
      if (successCalled) {
        throw new Error('SECURITY VIOLATION: callbacks.onSuccess called for tampered proof!');
      }
      if (!errorCalled) {
        throw new Error('Expected callbacks.onError to be called');
      }
      if (!failedReason.includes('MERKLE_PROOF_INVALID')) {
        throw new Error(`Expected MERKLE_PROOF_INVALID reason, got: ${failedReason}`);
      }
      console.log('  ✅ Injected proof tampering successfully detected and suppressed:');
      console.log(`     Reason: ${failedReason}`);
      console.log('     Billing callback: SUPPRESSED');
      console.log('     HLS pipeline delivery: SUPPRESSED');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // ─── Test 3: Authentic Content Baseline ──────────────────────────
  console.log('\nTest 3: Valid authentic content and cryptographic proof baseline...');
  {
    let verifiedCalled = false;
    let successCalled = false;
    let errorCalled = false;

    const originalFetch = global.fetch;
    global.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/content/')) {
        return new Response(authenticBytes, {
          status: 200,
          headers: { 'Content-Type': 'video/mp2t' },
        });
      }
      return originalFetch(input);
    };

    try {
      const LoaderClass = createStreamPayFragmentLoader({
        sessionId: '0x' + '33'.repeat(32),
        streamId: manifest.streamId,
        accessServiceUrl,
        manifest,
        onAccessTokenRequest: async () => mockAccessToken,
        onSegmentVerified: (idx, duration) => {
          verifiedCalled = true;
          console.log(`     Billing verified for segment ${idx} (${duration} units)`);
        },
        onSegmentFailed: () => {},
      });

      const loader = new LoaderClass({});
      const context = { url: `/api/access/content/${manifest.streamId}/segment_0.ts` };
      const callbacks = {
        onSuccess: () => {
          successCalled = true;
        },
        onError: () => {
          errorCalled = true;
        },
      };

      await new Promise<void>((resolve) => {
        const origOnError = callbacks.onError;
        callbacks.onError = () => {
          origOnError();
          resolve();
        };
        const origOnSuccess = callbacks.onSuccess;
        callbacks.onSuccess = () => {
          origOnSuccess();
          resolve();
        };

        loader.load(context, {}, callbacks);
      });

      if (!verifiedCalled) throw new Error('Expected onSegmentVerified to be called for valid content');
      if (!successCalled) throw new Error('Expected callbacks.onSuccess to be called for valid content');
      if (errorCalled) throw new Error('callbacks.onError should not be called for valid content');
      console.log('  ✅ Authentic media bytes and canonical Merkle proof successfully verified and delivered');
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log('\n🎉 ALL Fragment Loader Corruption Tests PASSED!\n');
}

main().catch((err) => {
  console.error('\n❌ Fragment Loader Corruption Test Failed:', err);
  process.exit(1);
});
