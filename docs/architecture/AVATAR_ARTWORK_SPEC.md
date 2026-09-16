# Avatar artwork contract v1 — Phase4

Owner scope: [AVATAR_PHASE4_AUTHORITY](../execution/AVATAR_PHASE4_AUTHORITY.md).
These are production-authoring requirements, not permission to create/upload real artwork.
Only generated local test raster fixtures exist in this milestone. No schema changes.

## Canonical coordinates and deliverables

| Layer | Canonical coordinates | Recommended source | Accepted derivative |
|---|---|---|---|
| AVATAR, either appearance | x0–400, y0–1000, width:height2:5 | 800×2000 transparent raster | 400×1000 or800×2000 WebP alpha |
| JACKET, PANTS, BOOT | Same400×1000 body artboard, including transparent space outside garment | 800×2000 transparent raster | Same dimensions/aspect as body |
| SKI | x0–80, y0–1000, width:height2:25 | 160×2000 transparent raster | 80×1000 or160×2000 WebP alpha |

Raster images must use transparent backgrounds and contain visible nontransparent pixels.
No embedded captions, model labels, watermark text, EXIF/ICC/XMP/IPTC metadata, animation,
SVG, external references or executable content. Customer copy is accessible HTML outside
the image. The test fixture instead uses flat geometry with conspicuous diagonal stripes,
and its surrounding staff screen says SYNTHETIC / TEST ONLY in both languages.

AVATAR physical head top is exactly y0; sole bottom exactly y1000 (last raster row).
The visible figure must touch both physical edges: no transparent top/bottom padding.
Use horizontal safe margin40 canonical units except deliberate authored hand/foot bounds.
Both appearances share these physical/garment coordinates. They are appearance choices,
not sex/gender/body-type measurements. Do not encode sizing or eligibility differences.

SKI must be a straight full-length tip-to-tail view. Tip touches the first pixel row,
tail touches the last; no transparent top/bottom padding, perspective foreshortening,
shadow beyond physical bounds or cropped tip/tail. Horizontal transparency is allowed.
The80:1000 artboard controls display width only; it does not assert a real ski width.
Do not stretch photographed product art into this format: prepare a suitable authored view.

JACKET, PANTS and BOOT retain the complete body artboard, not a garment-tight crop. Design
them against the same neutral body: nominal head y0–140, shoulders y150, waist y520,
ankles y920, floor y1000. Both appearances must support the same overlays. Garment pixels
may be absent from top/bottom rows; preserve that transparency. Layer stacking is body,
pants, jacket, boots. Ski remains beside the body in its own lane.

## Anchor and position semantics

Metadata anchor and position are normalized values0–1. For body/garment artboards,
the pixel offset is `(position − anchor) × (400,1000)` in canonical units. Body horizontal
offset moves its overlay coordinate origin with it; each garment then applies its own
offset relative to that body origin. Default anchor=position=(0.5,1) gives full alignment.
Use shared anatomical landmarks to author nondefault garment alignment; no random offsets.

For AVATAR and SKI physical reference layers, anchor.y must equal position.y: their physical
vertical offset is zero, preserving the common floor. A nonmatching pair makes that image
unavailable rather than silently violating the physical scale. Default is(0.5,1) for both.
Ski horizontal position uses its own80×ratio artboard and normalized anchor/position within
a separate lane. Do not use ski offsets to fake length or change its floor alignment.

The renderer uses canonical body physical height1000 and ski height
`1000 × skiToBodyRatio`. This must equal `1000 × skiLengthCm / customerHeightCm`.
Both terminate at floor y1000. Example170cm body /153cm ski gives900 canonical ski units,
with its tip at y100 and tail at y1000. A187cm ski extends to y−100, sharing the floor.
The renderer computes the union of all actual image boxes plus40 canonical units of safe
stage margin on every edge, then scales the *whole* stage uniformly to available width.
No independent mobile shortening, stretching, clipping or ratio correction is allowed.

## Delivery and rights

Use static alpha WebP only. The server checks RIFF length/chunks, bounded decode (at most
1.6million pixels, height2000,4MiB), alpha presence, aspect ratio and body/ski physical crop.
Only VP8X/VP8/VP8L/ALPH chunks are accepted; metadata/animation/trailing chunks are rejected.
Existing Sharp is reused. Byte validation proves this format/crop contract, not that a
human artist's anatomical or product depiction is truthful; real art still requires review.

Register derivative digest under existing immutable private content records only after
approved artwork and purpose-grant authority. Grant must explicitly bind visual UUID,
layer/appearance/classification/promise, media ID and derivative SHA to
AVATAR_VISUALIZATION_V1 in a current released immutable revision. General model-photo
rights do not grant generic Avatar use. Original files never use the Avatar byte route.

`GET /avatar-media/<visualUuid>/<sha256>` checks current rights/release twice around
bounded byte reading/validation and uses private,no-store. No client revision/release/rights
claims, query parameters, URLs, arbitrary filenames or object keys are accepted. Phase4
requires an authorized staff session and BOOKING_VIEW for the image as well as a protected
preview page. Production runtime stays unconnected. No normal guest route links to this.
Any future customer media permission/authoring flow is a separate Phase5 decision.

## Missing art and PDF reconciliation

Zero visualization → no renderer. Missing body → no substitute silhouette. Missing ski →
no substitute product. Missing garment → omit that garment only. Existing numeric business
text may remain. Ratios alone do not invent artwork. AV-2 is specified this way without
claiming the historical LOW independently closed. AV-1/AV-3 remain OPEN.

The supplied Implementation Package v1 PDF is reference only (SHA256 recorded in the
prior inspection). Its example170/150 ratio and normalized anchors are retained. It has
no authoritative fixed artboard dimensions; the above dimensions are this explicit
renderer contract, not new DB fields. Its SVG/Canvas/Prisma and customer/editor directions
are superseded for this scope by the current Owner's HTML/CSS/WebP-only, schema-unchanged,
staff-only requirements. These choices do not revise recommendation or inventory rules.


## Phase5 local integration boundary

The same raster/artboard/rights contract applies to the guest candidate-step component.
There is no approved real artwork in the supplied Phase5 inputs. Synthetic generated
fixtures remain test-only and are never promoted by a passing test or review.
No real artwork creation, import, upload, hosted registration or activation occurred.

Guest metadata/image access is scoped to the ordinary authenticated guest context,
its current draft id/revision, saved recommendation owner and member key. Metadata
is not an authorization token. Each image GET repeats current scope/offered-reference
checks around current-rights byte delivery; old/foreign/revoked scopes return empty404.
Appearance stays in component state, not localStorage, profile, quote or booking data.
Existing candidate radios drive the displayed direction and require the existing
explicit group-selection action before any business choice is saved.

0032 preserves0001–0031 and makes visual bindings immutable. To adopt a different
approved revision/release/binding in a future authoring flow, create a new visual UUID
and matching immutable purpose grant; never retarget a granted row. This phase adds
no writer/editor endpoint. State/sort/normalized presentation fields remain mutable.
The dedicated local avatar_read role receives only the eligible-metadata view and the
current-eligible derivative function. Existing general content_read privileges are
historical and are not granted to the new Avatar role or used for Avatar reads.

Code-level guest integration is available only through the existing local development
runtime. Production fails closed. Public artwork activation remains false; the old
AVATAR_VISUALIZATION_FEATURE=false rollout marker is retained and is not an independent
runtime permission. Normal no-art completion: PHASE5_CODE_PASS_ARTWORK_INPUT_REQUIRED.
