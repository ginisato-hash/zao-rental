# R67 — public booking avatar activation

Owner direct instruction, 2026-10-16: 「アバターは公開ページ上でも出ていないなと感じていた 修正して表示がちゃんとされるようにしろ」.
Owner subsequently confirmed the exact existing three images: 「公開利用の権利がある。この3画像を使用する」.
This supersedes the old local/Preview-only approval for these images. It does not rewrite historical evidence or approve source photographs, exact product promises or new artwork.

Approved package: `docs/execution/avatar-artwork-activation/artwork/manifest.json`, SHA256 `34418edbb3cbb1a42474d979d9e938aa962429f286e72b9bff94517b4c6a36b7`.

| Image | SHA256 |
|---|---|
| appearance-1.webp | 6673481fbb876be97ebec2b2957709fdbad53f4686983c11e61319f601600e8e |
| appearance-2.webp | caf166774ab4a615aeaa93bfc31bce41d2d64756fee0117665f68f71b99aecfa |
| generic-ski.webp | 54a9d50c0f161714c8b168ecc59c9335f02a03b8f7cd700c0e656c24649e0b48 |

The existing renderer appears after a saved SKI/WEAR recommendation, with both reference appearances. SNOWBOARD and the marketing home page have no existing avatar renderer; this correction does not create a new illustration or placement.

## Composition

`ZAO_PRODUCTION_AVATAR_ACTIVATION=R67_PRIVATE_AVATAR_V1` opts the commercial runtime into its existing private media and guest avatar boundaries. Only when enabled does it read `COMMERCIAL_AVATAR_KEYS`: the dedicated avatar reader password, R2 account/bucket, read credential pair and expiry. Existing booking flags, merchant routing and pricing are preserved. The old ten-service credential activation plan is unchanged; the avatar credential is a separate provisioned binding.

The intake applies an operational display limit at the end of the approved season (2027-04-01 00:00 JST); this is not a statement about legal rights expiry.

Before enabling: verify the exact Production role and least privileges, current image/revision/release bindings, all three private R2 bytes and SHA256 metadata, disabled public bucket domains, and provider-confirmed Object Read scope/expiry. Existing Preview credentials must not be reused. No migration is needed. Owner GO does not substitute for these proofs.

Removing the avatar activation variable restores the prior booking profile without reading avatar credentials. A malformed or expired enabled binding fails startup; rotate before expiry or disable this capability before rebuilding. Runtime image retrieval failures remain isolated from booking, but startup failures are not silently ignored.

## Required acceptance

Natural Foundation and independent exact-tree review remain prerequisites for merge/deploy. Verify the actual protected Production artifact, then the same public artifact, in JA/EN at 390×844 and 1440×900: both appearances, image responses 200 and decoded pixels, size-reference alignment, current guest ownership, no-cookie/logout denial, no extra recommendation/HOLD/quote write from visual controls. Retain actual evidence; configuration readiness alone is not visual acceptance.

The prior natural CI failure at the first staff avatar-media GET on b029377 remains root-cause-unproven. Fixture-only fixed module/handler markers and scoped error/response enums improve the next natural run's evidence without warmup, retries, weakened assertions or raw exception logging. The staff local media path is separate from the Production guest media path.
