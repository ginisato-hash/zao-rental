# R64 UI — assets and visual source

Visual source of truth (Owner GO, Issue #47 comment 6148169405): the SALOMON STATION ZAO LP, `https://salomonstation-zao.com/lp`.
The LP stylesheet that was measured has sha256 `86bff742232579dd06056b1b8c41a492edb12506a876a96f47c6f66d311eaaad`. It is byte-identical to the Owner's LP source. No LP code was copied: the design system was rebuilt in `apps/web/src/app/globals.css`, `components/public.css`, `components/guest.css` and the console CSS files.

## Product images (new in R64)

These are the official Salomon product images and photos already used on the LP. The Owner approved them as an official tie-up on 2026-10-11, and the LP source records their provenance in `site/src/salomon-assets.json`. The files below are the LP's own derivatives, copied unchanged. Nothing is hotlinked.

| File | sha256 | Product | Source page |
|---|---|---|---|
| `apps/web/src/components/brand/product-smax8-800.webp` | `1e6ad0440bcc1db87ca0cbd1ad5560acd0f4fe4e8e7fabd60eb7c3e427bba544` | S/MAX 8 (REGULAR) | salomon.com/en-gb/product/s-max-8-and-m11-li1467/L45414200+ |
| `product-smax8-1280.webp` | `f010e68b305712f9599ed99716bbc81d7e03ff1c2c201a527ed8afa5f3d1afc2` | same | same |
| `product-qst-800.webp` | `4d909b407eb38c378b8ecbe52f49c7d39e52f39b9e4ef5d69cedf3b7df5dd4aa` | S/LAB QST BLANK action photo (PREMIUM) | salomon.com/en-gb/product/s-lab-qst-blank-li7032/L47713400+ |
| `product-qst-1280.webp` | `2ba554a683019533dd0392aeebbb5b666650f8a60c12d057ac558fb56150a6bc` | same | same |
| `product-assassin-800.webp` | `5f69e5821247de31862cb228a9486a23bb4fa5b4c887e54b8abf0fb397cbf1e3` | ASSASSIN PRO (SNOWBOARD) | salomon.com/en-gb/product/assassin-pro-li1301/L49292000 |
| `product-assassin-1280.webp` | `9785bc40cdc20311514551b6c4538f405371bbb796e4d88191a90ac1ee91b77c` | same | same |

Rules carried over from the LP and from P85:
- Alt text says the image is an official Salomon photo or product image.
- Images are never presented as Zao scenery or as confirmed stock.
- A small note states that an equivalent grade is provided and the pictured item may not be available.
- Ski photographs are never used for snowboard. The snowboard uses its own product image.

## SALOMON S mark

`components/brand/salomon-s-path.ts` holds the outline of the S. The LP traced it from the official SALOMON wordmark raster (IoU 0.9925). The Owner has permitted web use and colour changes of the SALOMON logos (Issue #47 comment 6090166024). It is used once, as a small mark on the home page's rental-desk board.

## Reused (unchanged from P85)

- Campaign photographs `campaign-{winter,ski,wear}-{desktop,mobile}.webp`.
- The Barlow Semi Condensed 700 font (OFL). Provenance is in `../p85-ui/ASSETS.md`.

## Removed

- `logo-stacked-black.webp` and `logo-stacked-white.webp`. The P85 header pill and footer logo plate are gone. The LP chrome uses edge-set type instead of a logo plate.
- The P85 campaign wheel (`HomeCampaigns.tsx`) and `BrandMark.tsx`.

## Not used

- The rotating extruded S hero. It is the LP's own signature. The booking site's home deliberately uses a different composition: an official photo with a sign-plate word, beside a live rental-desk board. This keeps the two properties from being confused with each other.
- The `ZAO ski 100` mark. The Owner approved it for the LP only.
- Store photographs and the LP's terrain map.
