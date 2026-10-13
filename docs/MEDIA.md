# Media Pipeline

The active demo streams are `monad-keynote-hd` and `real-demo`. The sidebar exposes `real-demo` as “Real Video Test”.

The five gated `monad-keynote-hd` segments live in `access-service/media/monad-keynote-hd/`. The `real-demo` stream contains three gated segments transcoded from the local `RuralFlowAI.mp4` source; they contain 1920×1080 H.264 video and AAC audio. Both streams are served through the Access Service only after voucher authorization.

The canonical manifest is generated from the media bytes. If the media changes, regenerate the manifest before deploying a new content root:

```bash
node scripts/generate_manifest.js
```

To verify the file type locally:

```bash
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height access-service/media/monad-keynote-hd/segment_0.ts
```

The failure demonstration intentionally flips a byte and verifies that SHA-256/Merkle validation rejects it before playback billing:

```bash
npx tsx scripts/failure-demo.ts
```

The dashboard displays each verified segment as a real MPEG-TS blob when the browser supports direct MPEG-TS playback. Browsers that do not decode MPEG-TS blobs directly show a clear HLS/MSE compatibility message after cryptographic verification; they do not mark unverified media as valid.

Do not replace the deployed media without regenerating and rebinding the manifest root; otherwise the contract/session content binding should reject it.
