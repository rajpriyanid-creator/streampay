# StreamPay — 3-Minute Hackathon Video Demo Script

**Track:** 02 Consumer Products & Payments | **Platform:** Monad Testnet (Chain ID 10143)  
**Total Duration:** 3:00 minutes (180 seconds)

---

### [0:00 - 0:30] Introduction: The Broken Subscription Model
- **Visual:** Speaker facecam or slide showing "$120/month across 5 subscriptions" vs StreamPay landing page.
- **Presenter:**
  > "Today, digital media is broken. Consumers pay over $100 a month for bundled subscriptions they barely use. If you want to watch a single 5-minute keynote, a 2-minute tutorial, or a pay-per-view match, you're forced to sign up for a monthly recurring subscription.
  > 
  > Meet **StreamPay** — the pay-per-second video streaming protocol built natively on **Monad**. With StreamPay, you pay only for the exact seconds of media you watch in USDC. No monthly lock-in, zero gas during playback, and instant escrow refunds the moment you hit pause."

---

### [0:30 - 1:15] Architecture: How It Works & Why Monad
- **Visual:** Clean diagram showing Monad Escrow Contract (`StreamPaySettlement.sol`) + Access Service + Video Player.
- **Presenter:**
  > "Streaming payments require three things traditional blockchains couldn't deliver: micro-cent fees, high concurrency, and sub-second finality.
  > 
  > On Monad, StreamPay uses a three-tier hybrid architecture:
  > 1. **Bounded Escrow:** The viewer locks a modest deposit (e.g. 2 USDC) on Monad in a single transaction.
  > 2. **Off-Chain EIP-712 Vouchers:** As each 2-second video segment plays, the client signs an off-chain micro-voucher for $0.001. There are **zero gas fees** while watching.
  > 3. **Cryptographic Zero-Trust Delivery:** Every segment is hashed with SHA-256 and proven against a Keccak-256 Merkle root stored on-chain. The viewer's client verifies the math before signing.
  > 4. **Batch Settlement:** The creator checkpoints the latest voucher on Monad to receive payouts, batching hundreds of off-chain payments into a single block."

---

### [1:15 - 2:05] Live Testnet Demo: Playback, Checkpointing & Instant Refund
- **Visual:** Screen recording of StreamPay Frontend on `localhost:3000` connected to Monad Testnet.
- **Action 1:** Click **"Connect Wallet"** with MetaMask on Monad Testnet (Chain ID 10143).
- **Action 2:** Select the **Monad Keynote HD** stream.
- **Action 3:** Click **"Open Session (Monad Testnet)"**. MetaMask pops up. Confirm transaction.
- **Action 4:** Session ID appears. Video begins streaming smoothly at 1080p.
- **Presenter:**
  > "Let's watch it live on Monad Testnet. I connect my wallet and open a session with a 1.00 USDC deposit. The transaction confirms in one second on Monad.
  > 
  > As the video plays, notice the real-time ticker: every 2 seconds, our custom HLS fragment loader downloads the media chunk, verifies its SHA-256 hash against the Merkle tree, and signs a micro-voucher for 500 base units ($0.0005 per second).
  > 
  > Now I click **Checkpoint**. The creator claims earned revenue on-chain.
  > Next, I pause and click **Close Session**. In a single Monad transaction, the session closes cooperatively: the creator receives $0.006 USDC, and my remaining $0.994 USDC deposit is instantly returned to my wallet. No money is locked or wasted."

---

### [2:05 - 2:35] Zero-Trust Security: Live Failure Demo (Tamper Rejection)
- **Visual:** Terminal window running `npx tsx scripts/failure-demo.ts`.
- **Presenter:**
  > "What if a rogue CDN node tries to serve malicious media, inject ads, or overcharge the viewer?
  > 
  > Let's run our automated failure demonstration: `npx tsx scripts/failure-demo.ts`.
  > - **Scenario 1:** Authentic media passes byte SHA-256 and Merkle proof verification; a voucher is issued.
  > - **Scenario 2:** We inject a single corrupted byte into the media stream. The StreamPay client detects the SHA-256 mismatch instantly, halts decoding, suppresses playback, and charges the viewer **zero dollars**.
  > - **Scenario 3:** We tamper with a Merkle proof sibling. The tree derivation fails against the on-chain root, and delivery is mathematically rejected."

---

### [2:35 - 3:00] Conclusion & Submission Overview
- **Visual:** GitHub repository, test badges, and Monad Explorer contract page.
- **Presenter:**
  > "StreamPay is fully open-source with 47 passing Foundry smart contract tests, 13 concurrency ledger tests, and 26 end-to-end integration tests. The settlement contract is live on Monad Testnet with verified payment token integration.
  > 
  > StreamPay turns pay-per-second streaming from an impossible dream into a reality on Monad. Thank you!"
