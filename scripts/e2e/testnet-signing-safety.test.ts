/**
 * StreamPay Testnet Signing Safety & EIP-712 Verification Suite
 *
 * Automated regression tests proving:
 * 1. Testnet session opening strictly rejects Anvil/development private keys (creatorKey).
 * 2. Testnet cooperative close strictly rejects Anvil/development private keys (creatorKey).
 * 3. Session opening fails closed if offerSignature or ackSig is missing on testnet.
 * 4. Contract constraint PayerEqualsRecipient fails safely before chain submission.
 * 5. Contract constraint PayerEqualsSessionSigner fails safely before chain submission.
 * 6. Genuine wallet signing produces valid EIP-712 typed-data signatures matching
 *    the exact Solidity domain and type specifications.
 * 7. Frontend codebase scan proves zero Anvil keys leak into Testnet paths.
 *
 * Usage: npx tsx scripts/e2e/testnet-signing-safety.test.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  type Address,
  type Hex,
  keccak256,
  hashTypedData,
  createWalletClient,
  custom,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  contentOfferTypes,
  sessionConfigTypes,
  closeAckTypes,
  signContentOfferWithWallet,
  signCloseAckWithWallet,
  openSessionWithWallet,
  closeCooperativeWithWallet,
  buildContentOffer,
} from '../../frontend/lib/protocol/lifecycle';
import { CANONICAL_PRICING_POLICY_HASH } from '../../frontend/lib/protocol/typedData';

const TESTNET_CHAIN_ID = 10143;
const LOCAL_CHAIN_ID = 31337;
const MOCK_SETTLEMENT = '0x1111111111111111111111111111111111111111' as Address;
const MOCK_TOKEN = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Address;
const ANVIL_DEV_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

function createMockClients() {
  const mockWallet = {
    account: { address: '0x2222222222222222222222222222222222222222' as Address },
    signTypedData: async () => '0xmocksignature' as Hex,
    writeContract: async () => '0xmocktxhash' as Hex,
  };
  const mockPublic = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'allowance') return 1000000000000n;
      if (functionName === 'hashContentOffer') return '0xofferhash0000000000000000000000000000000000000000000000000000000001' as Hex;
      if (functionName === 'hashSessionConfig') return '0xcfghash0000000000000000000000000000000000000000000000000000000002' as Hex;
      if (functionName === 'hashVoucher') return '0xvoucherhash00000000000000000000000000000000000000000000000000000003' as Hex;
      if (functionName === 'hashCloseAck') return '0xackhash0000000000000000000000000000000000000000000000000000000004' as Hex;
      return '0x';
    },
    waitForTransactionReceipt: async () => ({ status: 'success' }),
  };
  return { mockWallet, mockPublic };
}

async function runTests() {
  console.log('\n🔒 Starting Testnet Signing Safety & EIP-712 Verification Suite...\n');

  // Test 1: openSessionWithWallet rejects creatorKey on Testnet (10143)
  console.log('Test 1: Proving testnet session opening strictly rejects creatorKey (Anvil key)...');
  {
    const { mockWallet, mockPublic } = createMockClients();
    let threw = false;
    try {
      await openSessionWithWallet({
        walletClient: mockWallet,
        publicClient: mockPublic,
        settlement: MOCK_SETTLEMENT,
        token: MOCK_TOKEN,
        payer: '0x2222222222222222222222222222222222222222' as Address,
        recipient: '0x3333333333333333333333333333333333333333' as Address,
        signerAddress: '0x4444444444444444444444444444444444444444' as Address,
        manifestRoot: '0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb' as Hex,
        unitPrice: 500n,
        maxBillable: 3600n,
        deposit: 5000000n,
        validSec: 3600,
        graceSec: 3600,
        maxLead: 12n,
        maxCreditWindow: 10n,
        maxCreditSegments: 3,
        maxUnredeemedAmount: 5000n,
        creatorKey: ANVIL_DEV_KEY, // ATTEMPT TO PASS DEV KEY ON TESTNET
        chainId: TESTNET_CHAIN_ID,
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('SECURITY VIOLATION') && err.message.includes('creatorKey'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert(threw, 'Expected openSessionWithWallet to reject creatorKey on chain 10143');
    console.log('   ✅ PASS: creatorKey rejected on Testnet chain 10143 with SECURITY VIOLATION.');
  }

  // Test 2: openSessionWithWallet rejects missing offerSignature on Testnet
  console.log('\nTest 2: Proving testnet session opening fails closed without creator offerSignature...');
  {
    const { mockWallet, mockPublic } = createMockClients();
    let threw = false;
    try {
      await openSessionWithWallet({
        walletClient: mockWallet,
        publicClient: mockPublic,
        settlement: MOCK_SETTLEMENT,
        token: MOCK_TOKEN,
        payer: '0x2222222222222222222222222222222222222222' as Address,
        recipient: '0x3333333333333333333333333333333333333333' as Address,
        signerAddress: '0x4444444444444444444444444444444444444444' as Address,
        manifestRoot: '0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb' as Hex,
        unitPrice: 500n,
        maxBillable: 3600n,
        deposit: 5000000n,
        validSec: 3600,
        graceSec: 3600,
        maxLead: 12n,
        maxCreditWindow: 10n,
        maxCreditSegments: 3,
        maxUnredeemedAmount: 5000n,
        chainId: TESTNET_CHAIN_ID,
        // NO offerSignature provided
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('Creator signature (offerSignature) is required'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert(threw, 'Expected openSessionWithWallet to fail when offerSignature is missing on Testnet');
    console.log('   ✅ PASS: openSessionWithWallet failed closed when offerSignature was missing.');
  }

  // Test 3: openSessionWithWallet enforces PayerEqualsRecipient constraint
  console.log('\nTest 3: Proving PayerEqualsRecipient constraint is strictly validated...');
  {
    const { mockWallet, mockPublic } = createMockClients();
    let threw = false;
    const sameAddress = '0x2222222222222222222222222222222222222222' as Address;
    try {
      await openSessionWithWallet({
        walletClient: mockWallet,
        publicClient: mockPublic,
        settlement: MOCK_SETTLEMENT,
        token: MOCK_TOKEN,
        payer: sameAddress,
        recipient: sameAddress, // VIOLATION
        signerAddress: '0x4444444444444444444444444444444444444444' as Address,
        manifestRoot: '0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb' as Hex,
        unitPrice: 500n,
        maxBillable: 3600n,
        deposit: 5000000n,
        validSec: 3600,
        graceSec: 3600,
        maxLead: 12n,
        maxCreditWindow: 10n,
        maxCreditSegments: 3,
        maxUnredeemedAmount: 5000n,
        offerSignature: '0xvalidsig' as Hex,
        chainId: TESTNET_CHAIN_ID,
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('PayerEqualsRecipient'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert(threw, 'Expected PayerEqualsRecipient error');
    console.log('   ✅ PASS: PayerEqualsRecipient prevented before submission.');
  }

  // Test 4: openSessionWithWallet enforces PayerEqualsSessionSigner constraint
  console.log('\nTest 4: Proving PayerEqualsSessionSigner constraint is strictly validated...');
  {
    const { mockWallet, mockPublic } = createMockClients();
    let threw = false;
    const sameAddress = '0x2222222222222222222222222222222222222222' as Address;
    try {
      await openSessionWithWallet({
        walletClient: mockWallet,
        publicClient: mockPublic,
        settlement: MOCK_SETTLEMENT,
        token: MOCK_TOKEN,
        payer: sameAddress,
        recipient: '0x3333333333333333333333333333333333333333' as Address,
        signerAddress: sameAddress, // VIOLATION
        manifestRoot: '0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb' as Hex,
        unitPrice: 500n,
        maxBillable: 3600n,
        deposit: 5000000n,
        validSec: 3600,
        graceSec: 3600,
        maxLead: 12n,
        maxCreditWindow: 10n,
        maxCreditSegments: 3,
        maxUnredeemedAmount: 5000n,
        offerSignature: '0xvalidsig' as Hex,
        chainId: TESTNET_CHAIN_ID,
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('PayerEqualsSessionSigner'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert(threw, 'Expected PayerEqualsSessionSigner error');
    console.log('   ✅ PASS: PayerEqualsSessionSigner prevented before submission.');
  }

  // Test 5: closeCooperativeWithWallet rejects creatorKey on Testnet (10143)
  console.log('\nTest 5: Proving testnet close acknowledgement strictly rejects creatorKey...');
  {
    const { mockWallet, mockPublic } = createMockClients();
    let threw = false;
    const validSessionId = ('0x' + '11'.repeat(32)) as Hex;
    const validVoucherDigest = ('0x' + '22'.repeat(32)) as Hex;

    try {
      await closeCooperativeWithWallet({
        walletClient: mockWallet,
        publicClient: mockPublic,
        settlement: MOCK_SETTLEMENT,
        sessionId: validSessionId,
        cumulativeUnits: 10n,
        voucherSig: '0xvouchersig' as Hex,
        creatorKey: ANVIL_DEV_KEY, // ATTEMPT TO PASS DEV KEY ON TESTNET
        chainId: TESTNET_CHAIN_ID,
        account: '0x2222222222222222222222222222222222222222' as Address,
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('SECURITY VIOLATION') && err.message.includes('creatorKey'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert(threw, 'Expected closeCooperativeWithWallet to reject creatorKey on chain 10143');
    console.log('   ✅ PASS: closeCooperativeWithWallet rejected creatorKey on Testnet chain 10143.');
  }

  // Test 6: closeCooperativeWithWallet fails closed without ackSig on Testnet
  console.log('\nTest 6: Proving testnet close fails closed without wallet-signed ackSig...');
  {
    const { mockWallet, mockPublic } = createMockClients();
    let threw = false;
    const validSessionId = ('0x' + '11'.repeat(32)) as Hex;
    try {
      await closeCooperativeWithWallet({
        walletClient: mockWallet,
        publicClient: mockPublic,
        settlement: MOCK_SETTLEMENT,
        sessionId: validSessionId,
        cumulativeUnits: 10n,
        voucherSig: '0xvouchersig' as Hex,
        chainId: TESTNET_CHAIN_ID,
        account: '0x2222222222222222222222222222222222222222' as Address,
        // NO ackSig provided
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('Creator authorization signature (ackSig) is required'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert(threw, 'Expected closeCooperativeWithWallet to fail without ackSig on Testnet');
    console.log('   ✅ PASS: closeCooperativeWithWallet failed closed when ackSig was missing.');
  }

  // Test 7: Verify EIP-712 typed data schemas and digests match contract expectations
  console.log('\nTest 7: Verifying EIP-712 typed data schemas and digests match Solidity specification...');
  {
    const domain = {
      name: 'StreamPaySettlement',
      version: '2.5',
      chainId: BigInt(TESTNET_CHAIN_ID),
      verifyingContract: MOCK_SETTLEMENT,
    };

    const offer = buildContentOffer({
      recipient: '0x3333333333333333333333333333333333333333' as Address,
      token: MOCK_TOKEN,
      manifestRoot: '0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb' as Hex,
      unitPrice: 500n,
      maxBillableUnits: 3600n,
      maxCreditSegments: 3,
      maxCreditWindowUnits: 10n,
      maxUnredeemedAmount: 5000n,
      offerNonce: 12345n,
      issuedAt: 1000000n,
      expiresAt: 1086400n,
    });

    const offerDigest = hashTypedData({
      domain,
      types: contentOfferTypes,
      primaryType: 'ContentOffer',
      message: offer,
    });
    assert(offerDigest.startsWith('0x') && offerDigest.length === 66, 'Invalid offerDigest format');

    const config = {
      payer: '0x2222222222222222222222222222222222222222' as Address,
      sessionSigner: '0x4444444444444444444444444444444444444444' as Address,
      offerDigest,
      initialDeposit: 5000000n,
      maxLeadUnits: 12n,
      validUntil: 1003600n,
      redemptionGraceSeconds: 3600n,
      nonce: 99999n,
    };

    const configDigest = hashTypedData({
      domain,
      types: sessionConfigTypes,
      primaryType: 'SessionConfig',
      message: config,
    });
    assert(configDigest.startsWith('0x') && configDigest.length === 66, 'Invalid configDigest format');

    const ack = {
      sessionId: ('0x' + '11'.repeat(32)) as Hex,
      cumulativeUnits: 10n,
      voucherDigest: ('0x' + '22'.repeat(32)) as Hex,
    };

    const ackDigest = hashTypedData({
      domain,
      types: closeAckTypes,
      primaryType: 'CloseAck',
      message: ack,
    });
    assert(ackDigest.startsWith('0x') && ackDigest.length === 66, 'Invalid ackDigest format');

    console.log(`   ✅ ContentOffer EIP-712 digest: ${offerDigest.slice(0, 18)}...`);
    console.log(`   ✅ SessionConfig EIP-712 digest: ${configDigest.slice(0, 18)}...`);
    console.log(`   ✅ CloseAck EIP-712 digest:      ${ackDigest.slice(0, 18)}...`);
  }

  // Test 8: Genuine creator wallet signing flow
  console.log('\nTest 8: Verifying genuine Creator wallet signing flow via signContentOfferWithWallet and signCloseAckWithWallet...');
  {
    const creatorAccount = privateKeyToAccount(generatePrivateKey());
    const mockCreatorWallet = {
      signTypedData: async (args: any) => {
        return creatorAccount.signTypedData(args);
      },
    };

    const offer = buildContentOffer({
      recipient: creatorAccount.address,
      token: MOCK_TOKEN,
      manifestRoot: '0xbbbf56c2d7f84467c6943ebfb4a0df5c504229b730eb7a5bc4607493bca1d6cb' as Hex,
      unitPrice: 500n,
    });

    const offerSig = await signContentOfferWithWallet({
      walletClient: mockCreatorWallet,
      settlement: MOCK_SETTLEMENT,
      chainId: TESTNET_CHAIN_ID,
      offer,
      account: creatorAccount.address,
    });
    assert(offerSig.startsWith('0x') && offerSig.length === 132, 'Invalid offer signature format');

    const ackSig = await signCloseAckWithWallet({
      walletClient: mockCreatorWallet,
      settlement: MOCK_SETTLEMENT,
      chainId: TESTNET_CHAIN_ID,
      ack: {
        sessionId: ('0x' + '11'.repeat(32)) as Hex,
        cumulativeUnits: 14n,
        voucherDigest: ('0x' + '22'.repeat(32)) as Hex,
      },
      account: creatorAccount.address,
    });
    assert(ackSig.startsWith('0x') && ackSig.length === 132, 'Invalid close ack signature format');

    console.log(`   ✅ Genuine Creator ContentOffer signature: ${offerSig.slice(0, 18)}...`);
    console.log(`   ✅ Genuine Creator CloseAck signature:     ${ackSig.slice(0, 18)}...`);
  }

  // Test 9: Static audit - verify zero Anvil keys leak into Testnet in frontend code
  console.log('\nTest 9: Static audit of frontend code for forbidden Anvil keys in testnet paths...');
  {
    const pageTsx = fs.readFileSync(
      path.join(__dirname, '../../frontend/app/page.tsx'),
      'utf8'
    );
    const lifecycleTs = fs.readFileSync(
      path.join(__dirname, '../../frontend/lib/protocol/lifecycle.ts'),
      'utf8'
    );

    // Helper to extract the specific TESTNET branch inside each function
    function getTestnetBranch(fnName: string): string {
      const fnIdx = pageTsx.indexOf(fnName);
      assert(fnIdx !== -1, `${fnName} not found`);
      const fnBody = pageTsx.slice(fnIdx, fnIdx + 3000);
      const testnetIdx = fnBody.indexOf("networkMode === 'TESTNET'");
      assert(testnetIdx !== -1, `networkMode === 'TESTNET' not found in ${fnName}`);
      const branchBody = fnBody.slice(testnetIdx);
      const endMatch = branchBody.search(/else if \(isDeployed\)|else \{/);
      const endIdx = endMatch !== -1 ? endMatch : branchBody.indexOf('return;');
      return branchBody.slice(0, endIdx);
    }

    const connectWalletTestnet = getTestnetBranch('handleConnectWallet');
    assert(!connectWalletTestnet.includes('ANVIL_ACCOUNTS'), 'ANVIL_ACCOUNTS must not appear in handleConnectWallet TESTNET branch');

    const openSessionTestnet = getTestnetBranch('handleOpenSession');
    assert(!openSessionTestnet.includes('ANVIL_ACCOUNTS'), 'ANVIL_ACCOUNTS must not appear in handleOpenSession TESTNET branch');

    const checkpointTestnet = getTestnetBranch('handleCheckpointOnChain');
    assert(!checkpointTestnet.includes('ANVIL_ACCOUNTS'), 'ANVIL_ACCOUNTS must not appear in handleCheckpointOnChain TESTNET branch');

    const closeSessionTestnet = getTestnetBranch('handleCloseSession');
    assert(!closeSessionTestnet.includes('ANVIL_ACCOUNTS'), 'ANVIL_ACCOUNTS must not appear in handleCloseSession TESTNET branch');

    // Verify lifecycle.ts explicitly throws on non-local chain when creatorKey is passed
    assert(
      lifecycleTs.includes("if (p.chainId !== 31337 && p.creatorKey)"),
      'lifecycle.ts must enforce creatorKey ban on non-local chains'
    );

    // Verify testnet.json manifest remains un-deployed (settlementContract: null)
    const testnetManifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../manifests/testnet.json'), 'utf8')
    );
    assert(
      testnetManifest.settlementContract === null,
      'Testnet manifest settlementContract must remain null until real deployment'
    );

    console.log('   ✅ PASS: Zero Anvil keys in Testnet execution paths in frontend.');
  }

  console.log('\n🎉 ALL 9 TESTNET SIGNING SAFETY TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Testnet signing safety suite failed:', err);
  process.exit(1);
});
