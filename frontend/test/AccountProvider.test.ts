import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TestProvider } from '../lib/account/AccountProvider';

describe('TestProvider Security Enforcement', () => {
  it('throws on construction when network is testnet via parameter', () => {
    assert.throws(
      () => new TestProvider(undefined, 'testnet'),
      /TestProvider is unavailable on testnet/
    );
  });

  it('throws on construction when network is mainnet via parameter', () => {
    assert.throws(
      () => new TestProvider(undefined, 'mainnet'),
      /TestProvider is unavailable on mainnet/
    );
  });

  it('throws on construction when process.env.NETWORK is testnet', () => {
    const prev = process.env.NETWORK;
    try {
      process.env.NETWORK = 'testnet';
      assert.throws(
        () => new TestProvider(),
        /TestProvider is unavailable on testnet/
      );
    } finally {
      if (prev !== undefined) process.env.NETWORK = prev;
      else delete process.env.NETWORK;
    }
  });

  it('throws on construction when process.env.NEXT_PUBLIC_NETWORK is mainnet', () => {
    const prev = process.env.NEXT_PUBLIC_NETWORK;
    try {
      process.env.NEXT_PUBLIC_NETWORK = 'mainnet';
      assert.throws(
        () => new TestProvider(),
        /TestProvider is unavailable on mainnet/
      );
    } finally {
      if (prev !== undefined) process.env.NEXT_PUBLIC_NETWORK = prev;
      else delete process.env.NEXT_PUBLIC_NETWORK;
    }
  });

  it('instantiates cleanly on local network', async () => {
    const provider = new TestProvider(undefined, 'local');
    const addr = await provider.getAddress();
    assert.strictEqual(addr, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });
});
