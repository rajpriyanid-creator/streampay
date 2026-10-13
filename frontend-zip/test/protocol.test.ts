import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessServiceClient } from '../src/lib/protocol/accessClient';
import { computeSegmentLeaf, computeSha256, verifySegmentIntegrity } from '../src/lib/protocol/manifest';

const zeroHash = `0x${'00'.repeat(32)}` as `0x${string}`;

test('valid segment bytes pass SHA-256 and Merkle verification', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const segment = {
    segmentIndex: 0,
    durationUnits: 2,
    costUSDC: '1000',
    cumulativeUnits: '2',
    contentIdHash: zeroHash,
    renditionIdHash: zeroHash,
    segmentSha256: await computeSha256(bytes),
    byteLength: bytes.length,
    merkleProof: [],
  };
  const result = await verifySegmentIntegrity(bytes, segment, computeSegmentLeaf(segment));
  assert.equal(result.sha256Valid, true);
  assert.equal(result.merkleValid, true);
});

test('tampered segment bytes are rejected', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const segment = {
    segmentIndex: 0,
    durationUnits: 2,
    costUSDC: '1000',
    cumulativeUnits: '2',
    contentIdHash: zeroHash,
    renditionIdHash: zeroHash,
    segmentSha256: await computeSha256(bytes),
    byteLength: bytes.length,
    merkleProof: [],
  };
  await assert.rejects(
    verifySegmentIntegrity(new Uint8Array([9, 2, 3, 4]), segment, computeSegmentLeaf(segment)),
    /SHA-256 mismatch/
  );
});

test('access service errors are not replaced by browser fallback data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('backend offline'); }) as typeof fetch;
  try {
    const client = new AccessServiceClient('http://backend.invalid');
    await assert.rejects(client.getHealth(), /backend offline/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
