# Media credits

The five MPEG-TS files in `access-service/media/monad-keynote-hd/` and the
matching files in `fixtures/media/` are repository-generated synthetic test
fixtures used solely to exercise HLS delivery, hashing, and Merkle proofs.

| Files | Source | Author | License |
|---|---|---|---|
| `segment_0.ts` through `segment_4.ts` in both fixture directories | Generated for this repository; no external keynote footage | StreamPay project team / Rajpriyan S | MIT, as repository test data |

They are not a copy of an unlicensed keynote recording. The canonical hashes
are regenerated with `node scripts/generate_manifest.js` whenever fixture bytes
change.
