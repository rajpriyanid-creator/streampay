# Media Pipeline

The active demo stream is `monad-keynote-hd`.

Its five gated segments live in `access-service/media/monad-keynote-hd/` and are real MPEG-TS media containing H.264 video and AAC audio. The current sample is 640×360 and is served through the Access Service only after voucher authorization.

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

Do not replace the deployed media without regenerating and rebinding the manifest root; otherwise the contract/session content binding should reject it.
