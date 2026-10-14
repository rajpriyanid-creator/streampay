# StreamPay — Hackathon Video Production Guide & Voiceover Scripts

> **Purpose:** This guide contains the complete, word-for-word scripts and second-by-second screen recording directions for both the **3-Minute Demo Video** and the **2-Minute Pitch Video**, optimized specifically for **Sarvam AI Voiceover** (deep male voice, natural pacing, clear phonetic phrasing).

---

## 🎙️ Sarvam AI Voiceover Setup & Tuning Tips

When generating the audio in **Sarvam AI**:
1. **Voice Selection:** Choose a deep, authoritative, and confident male voice (e.g., *Arvind*, *Rohan*, or *Dev* with neutral Indian/Global English accent).
2. **Pacing / Speed:** Set speech rate to **1.0x (Normal)** or **0.95x**. This guarantees ~125–135 words per minute, giving judges time to digest complex technical concepts while staying strictly within the time limits.
3. **Punctuation & Breath Marks:**
   - Ellipses (`...`) create a natural 0.5-second pause between thoughts.
   - Em-dashes (`—`) indicate emphasis.
   - Acronyms are phonetically written out below (e.g., `U-S-D-C`, `M-E-R-K-L-E`, `M-O-N-A-D`) so Sarvam AI pronounces individual letters and words with crisp clarity.
4. **Video Recording Settings (OBS / Loom):**
   - Resolution: `1920x1080` (1080p 60fps).
   - Browser Zoom: Set browser zoom to `100%` or `110%` on Chrome/Brave.
   - URL: Use the live deployed URL: [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com).
   - Clean UI: Close extraneous browser tabs and bookmarks. Ensure the testnet wallet has Monad Testnet USDC ready.

---

# 🎬 VIDEO 1: The 3-Minute Demo Video (Product in Action)
 
* **Published Demo Link:** [https://youtu.be/ggIfTzzRqQo](https://youtu.be/ggIfTzzRqQo)
* **Hackathon Limit:** Up to 3 minutes (180 seconds).
* **Target Video Runtime:** **2 minutes 50 seconds** (170 seconds).
* **Rule Compliance:** Shows the real working product on Monad Testnet, live transactions, Merkle verification, and zero slides or static code reviews.

| Timestamp | Screen Action & Visuals (What to Show on Screen) | Sarvam AI Voiceover Script (Exact Text to Generate) |
| :---: | :--- | :--- |
| **0:00 - 0:25** | **Screen:** Start on the live web application at `streampay-frontend.onrender.com`.<br>• Show the dark-gold dashboard, pinned left sidebar, centerpiece video player, and real-time metrics grid.<br>• Mouse hovers over the Monad Testnet badge (`Chain ID 10143`). | "Welcome to StreamPay... the first sub-cent, pay-per-second video streaming protocol built natively on Monad. Today, we are demonstrating our live, end-to-end working deployment on Monad Testnet, running our verified settlement smart contract. With StreamPay, consumers pay only for the exact seconds of media they watch... with zero gas fees during streaming, instant cryptographic verification, and automated escrow refunds." |
| **0:25 - 0:55** | **Screen:** Click the **Connect Wallet** button in the header.<br>• Dynamic SDK modal pops open seamlessly.<br>• Show wallet connected to Monad Testnet.<br>• Click **Open Payment Session**.<br>• Enter deposit amount `1.000` USDC.<br>• MetaMask pops up; click **Confirm**.<br>• 1 second later, session status switches to `Active` with session ID displayed. | "Let's open a live streaming session. In the top right, I connect using our integrated Dynamic SDK... supporting both Web3 native wallets and seamless social onboarding. Next, I click Open Payment Session with an initial deposit of one U-S-D-C. Notice how quickly Monad confirms the transaction in under one second. Our bounded escrow contract is now live on-chain, and the session is active." |
| **0:55 - 1:35** | **Screen:** Click **Play** on the centerpiece video player.<br>• The Monad Keynote HD video streams smoothly.<br>• Zoom in slightly on the live metrics below the player:<br>  - Units streamed ticks upward: `2s`, `4s`, `6s`, `8s`...<br>  - Cumulative USDC spent updates live: `$0.001`, `$0.002`, `$0.003`...<br>  - Unused balance reflects remaining escrow.<br>• Show the green pill: `Merkle & SHA-256 Verified`.<br>• Point mouse at the Envio HyperIndex Telemetry card in the right sidebar. | "Now, I hit play. As the video streams, our custom H-L-S fragment loader downloads each two-second segment and validates its S-H-A 256 hash against the on-chain Merkle root. Once verified, the client signs an off-chain E-I-P 712 micro-voucher. Notice the critical breakthrough: there are zero gas fees and zero wallet popups while watching. In the right panel, our Envio HyperIndex indexer live-tracks our session events in real time." |
| **1:35 - 2:05** | **Screen:** Navigate to the **Payments** tab or click **Checkpoint**.<br>• Click **Checkpoint Session**; creator claims accrued revenue.<br>• Click **Pause**, then click **Close Session**.<br>• Show the cooperative close confirmation dialog.<br>• Confirm in wallet.<br>• Show transaction confirmation: creator receives earned USDC ($0.05), and remaining deposit ($0.95) is immediately refunded to viewer wallet.<br>• Point to the **Claim Refund** button. | "Now, let's settle the session. At any time, the creator can checkpoint cumulative vouchers on Monad to withdraw earned revenue. When the viewer stops watching, clicking Close Session initiates a single cooperative closeout. The creator receives their earned cents, and one hundred percent of the unused deposit is refunded directly to the user's wallet. If an uncooperative close ever occurs, the viewer claims their credit on-chain with a single click." |
| **2:05 - 2:35** | **Screen:** In the header, click the compact **Manifest** button.<br>• The **Stream Manifest Inspector Modal** opens.<br>• Show Merkle root hash, Content ID, and syntax-highlighted JSON payload.<br>• Switch to split terminal window and run:<br>  `npx tsx scripts/failure-demo.ts`<br>• Terminal shows Scenario 1 (Green Authentic), Scenario 2 (Red Tampered Byte Rejected), Scenario 3 (Forged Proof Rejected). | "StreamPay guarantees zero-trust delivery. By clicking our Manifest Inspector, anyone can verify the cryptographic Merkle tree and Content I-D. Even better, let's run our automated failure demonstration. In scenario two, when a malicious C-D-N injects a single altered byte, the client detects the mismatch in under one millisecond, suppresses playback, and bills the viewer exactly zero dollars. Honest delivery is rewarded; tampered delivery is mathematically blocked." |
| **2:35 - 2:50** | **Screen:** Show MonadScan explorer contract page: `0x3E016fa8...`<br>• Show Foundry test suite summary: `47 tests passed`.<br>• Show final URL: `streampay-frontend.onrender.com`. | "StreamPay brings production-ready, pay-per-second streaming to Monad today... backed by forty-seven passing Foundry smart contract tests and full Envio and Dynamic integrations. Check out our live deployment at streampay-frontend.onrender.com. Thank you." |

---

# 🎤 VIDEO 2: The 2-Minute Pitch Video (Team, Problem & Vision)

* **Hackathon Limit:** Up to 2 minutes (120 seconds).
* **Target Video Runtime:** **1 minute 52 seconds** (112 seconds).
* **Rule Compliance:** Introduces the team, articulates the problem, explains why Monad enables this breakthrough, and presents the market vision.

| Timestamp | Visual & B-Roll Directions (What to Show on Screen) | Sarvam AI Voiceover Script (Exact Text to Generate) |
| :---: | :--- | :--- |
| **0:00 - 0:25** | **Visual:** Facecam or clean motion graphics showing the subscription problem.<br>• Slide/Graphic: "$120/Month across Netflix, Disney+, Substack, Spotify" vs. a calendar showing 90% wasted unused days.<br>• Red cross over "$15/month paywall for a 5-minute video". | "Every month, millions of consumers throw away over one hundred dollars on recurring digital subscriptions they barely use. If you want to watch a single five-minute tutorial, a live sports match, or an educational keynote, you are forced to buy a full monthly subscription. For creators, centralized platforms take forty percent cuts and hold payouts for sixty days. The entire media monetization model is broken." |
| **0:25 - 0:45** | **Visual:** Founder/Team slide with team photo/avatars, GitHub profile, and project badge: **StreamPay on Monad**.<br>• Text: *Created for Monad Metropolis Hackathon — Track 02: Consumer Products & Payments*. | "Hi, I am Rajpriyan, the creator of StreamPay. As engineers building on decentralized rails, we asked a simple question: What if consumers could pay strictly for what they watch, second by second, with zero gas fees and zero friction? That is why we built StreamPay for the Monad Metropolis Hackathon, competing in Track Zero-Two: Consumer Products and Payments." |
| **0:45 - 1:15** | **Visual:** Fast, dynamic B-roll clips of the StreamPay web UI in action.<br>• Highlight 1: The smooth video player with live ticker.<br>• Highlight 2: Monad comparison card: *Ethereum ($5 gas / 12s blocks) vs. Monad (10,000 TPS / 1s finality)*.<br>• Highlight 3: Dynamic SDK one-click wallet login. | "StreamPay transforms streaming from rigid subscriptions into fluid micro-metering. On legacy blockchains, this was technically impossible. Ethereum gas fees and slow block times make second-by-second billing laughable. But Monad changes everything. With ten thousand T-P-S and sub-second finality, Monad enables high-frequency, parallel micro-settlements at sub-cent costs. Combined with off-chain E-I-P 712 vouchers and Dynamic's embedded auth, consumers stream without crypto friction." |
| **1:15 - 1:40** | **Visual:** Graphic illustrating the Win-Win economic model.<br>• Viewer graphic: 1.00 USDC deposit -> watches 2 mins -> $0.06 billed -> $0.94 refunded instantly.<br>• Creator graphic: Instant verifiable revenue streaming directly to creator wallet.<br>• Show Envio HyperIndex and Dynamic SDK sponsor bounty badges. | "Here is the math: A viewer deposits one U-S-D-C into bounded escrow. They watch an eight-minute tutorial, costing twenty-four cents. When they stop watching, the session closes cooperatively: the creator receives twenty-four cents instantly, and seventy-six cents is refunded immediately to the viewer's wallet. Consumers save over ninety percent compared to monthly paywalls, while creators earn instant, verifiable income." |
| **1:40 - 1:52** | **Visual:** MonadScan verified contract badge (`0x3E016fa8...`), GitHub repository link, and live URL: `streampay-frontend.onrender.com`.<br>• Final logo splash with golden ribbon wave: **StreamPay — Pay for what you watch.** | "StreamPay is fully deployed on Monad Testnet, completely open-source, and verified with extensive test suites. We are ready to bring the next hundred million consumers on-chain. Try the live demo at streampay-frontend.onrender.com. Thank you." |

---

## 🛠️ Step-by-Step Recording Instructions for You

### 1. Generating the Audio in Sarvam AI:
1. Open [Sarvam AI Audio Console](https://www.sarvam.ai).
2. Choose **Text-to-Speech (TTS)**.
3. Select **Language:** `English (India)` or `English (Global)`.
4. Select **Speaker:** Choose a confident, deep male voice (such as `Arvind` or `Dev`).
5. Copy and paste the voiceover script blocks from the tables above directly into the console.
6. Click **Generate** and download the `.mp3` or `.wav` files.

### 2. Recording the Screen Video:
1. Open **OBS Studio** or **Loom**.
2. Set recording window to **1920x1080**.
3. Open [https://streampay-frontend.onrender.com](https://streampay-frontend.onrender.com).
4. For the **Demo Video**:
   - Follow the **Screen Action & Visuals** column second-by-second.
   - Do the actions at a calm, deliberate pace so the viewer can follow your cursor.
5. For the **Pitch Video**:
   - You can record yourself on webcam, or use slides/screen-recordings matching the visual column.

### 3. Syncing Video & Voiceover (in CapCut, Premiere, or DaVinci):
1. Import the Sarvam AI audio track and your screen recording into any free editor (e.g. CapCut, DaVinci Resolve, or iMovie).
2. Align the audio with the screen actions.
3. If any blockchain transaction takes 2-3 seconds to confirm, speed up that clip slightly (`1.2x`) so the action matches the audio.
4. Export the Demo Video (under 3:00) and Pitch Video (under 2:00) in **1080p MP4**.
5. Upload to **YouTube** (Unlisted or Public) or **Loom**, and paste the links into your submission form!
