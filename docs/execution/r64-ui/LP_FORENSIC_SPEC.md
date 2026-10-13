# SALOMON STATION ZAO LP — forensic design spec (R64 Phase 1)

Captured 2026-10-13 from https://salomonstation-zao.com/lp (live).
Live `lp.css?v=9c6cb8aad3` sha256 86bff742…aaad and `lp.js` sha256 e7344f94…bbaec are byte-identical
to the Owner's local LP source `~/salomon-station-zao-lp/v2/site/src/{lp.css,lp.js}`, so every computed
value below is exact (read from the shipped stylesheet and confirmed by getComputedStyle at 1440×900).
Screens: `.local/r64/lp/*.png` (1440×900, 390×844 @2x touch, 768×1024).

## Measured tokens
| Token | Value | Evidence |
|---|---|---|
| ink / snow | #000 / #fff | body computed rgb(0,0,0) on rgb(255,255,255) |
| fog (image well) | #CDCCCC | `.lu .ph2`, map bg |
| sub (quiet copy) | #555 | `.note`, `.ft`, `.rows small` |
| accent | #668499 (steel blue) — used ONLY for the selected store pin + pulse ring | `.stp.on` |
| dimmed menu item | #3b3b3b on black | `.mnu ul:hover .mi` |
| unselected segment text | #6b6b6b on white, 2px black border | `.seg button` |
| display face | Barlow Semi Condensed 700 (OFL, same woff2 already in rental repo `components/brand/`) | document.fonts loaded |
| body face | Helvetica Neue / Helvetica / Arial / Hiragino Kaku Gothic ProN / Noto Sans JP | body computed |
| body | 16px / 24px (ja 1.7 → 27.2px) | computed |
| easing | cubic-bezier(.4,0,.2,1) everywhere | `--e` |
| gutter | clamp(16px, 2.4vw, 32px) → 32px @1440, 16px @390 | `.hd` padding 0 32px |
| header height | 72px desktop / 60px <768 | `.hd` rect h72 |
| breakpoint | single: 767px; plus `(hover:none)` for hover-only imagery | media queries |
| radius / shadow | 0 / none — everything square and flat | whole sheet |
| rules | 2px solid ink for structural rules, 1px ink for row separators | `.rows`, `.info` |

## Typography scale (all display = Barlow 700, uppercase)
- Page h1: clamp(96px, 18vw, 280px) / .78, margin-left −.05em (optical flush). PRICE @1440 = 259px.
- Menu items: clamp(56px, min(11vw,14.5vh), 168px) / .86; mobile clamp(52px, min(17vw,11vh), 96px).
- Final-CTA h2: clamp(72px, 12.6vw, 236px) / .8.
- Section h2 / card names: clamp(48–52px, 5–6.6vw, 80–108px) / .84.
- Big price: clamp(84px, 9.6vw, 156px) / .82, tabular-nums, letter-spacing −.01em; changes animate `flip` .25s (opacity .2→1, translateY 6px→0).
- Row label: clamp(26px, 2.6vw, 38px) / .95; row price clamp(34px, 3.4vw, 52px).
- Chrome type: 16px/16px, letter-spacing .02em (0.32px measured).
- Eyebrow/label: 13px/16px Barlow uppercase (`.lbl`, `.tax`).
- Quiet copy: 12–13px, #555, line-height 1.6.
- Japanese inside display contexts falls back to Hiragino at the same weight (e.g. セット/板のみ in rows).

## Components
- **Header (`.hd`)**: fixed, transparent, `mix-blend-mode: difference`, white text → legible on white, black and photos. Left: `SALOMON STATION ZAO` home link (sub pages only). Right: `JP EN` (inactive .42 opacity) + `MENU`/`CLOSE` toggle, 44px hit height (14px padding). No pill, no border, no logo image in chrome.
- **Menu (`.mnu`)**: full-viewport black field; opens with `clip-path: inset(0 0 100% 0) → inset(0)` .5s; items slide up from translateY(105%) .6s with .04s stagger; set asymmetric (margin-left 0/11/4/17/7 vw; mobile 0/9/3/13/6 vw). Hover dims siblings to #3b3b3b and nudges hovered item 2vw; current page = outlined (text-stroke 1.5px). Desktop hover reveals a cropped 4:5 official image on the right (clip-path wipe .45s), hidden on touch. Ends with the BOOK CTA (white variant). Esc closes and returns focus; keyboard-open focuses the first item; html scroll lock.
- **CTA (`.cta`)**: square, min-height 56px, padding 15px 18px, Barlow 22px uppercase, black (or white on black), label left + arrow `↗` 26px right, gap 24px, min-width min(320px, 80vw|100%). Hover: #262626 (white variant #e5e5e5). No radius, no shadow. Outline variant = inset 2px currentColor.
- **Segmented selector (`.seg`, `.days`, `.tabs`)**: grid of square buttons, 2px gap, 2px black border, min-height 48px, Barlow 18px uppercase; pressed = solid black/white text (`aria-pressed`). Small sub-label 12px inside (e.g. `13+`). Days = 11 equal squares; on mobile becomes a horizontally scrolling sticky strip under the header.
- **Big value block (`.big`)**: 2px top rule, 14px gap, giant number, caption 15px Barlow uppercase summarising the selection (`SKI · セット · REGULAR · ADULT — 1日`).
- **Rows list (`.rows`)**: 2px top rule, each row grid [label | price] aligned to baseline, 1px bottom rule, 16/14px vertical padding.
- **Image tiles (`.lu`)**: 4:5 fog well, object-fit cover, hover scale 1.03 .6s; staggered 12-col asymmetric grid (7/5 cols, offsets 22vh/10vh); mobile single column 56px gap.
- **Definition list (`.info`)**: 2px rules, 4/7 column split, dt Barlow 22px (ja: body 17px bold).
- **Final band (`.fin`)**: black, giant 2-line headline "Book your / Zao winter.", white CTA, then full-bleed official campaign photo 3200×888.
- **Footer (`.ft`)**: one quiet 12px #555 line; no columns, no logo wall.
- **Reveal (`.rv`)**: opacity 0 / translateY 18px → in, .5s, IntersectionObserver rootMargin −8%.

## Motion inventory
| Motion | Duration / easing | Reduced motion |
|---|---|---|
| Menu wipe | clip-path .5s e | instant |
| Menu item rise | .6s e, stagger .04s | none |
| Hover image wipe | .45s e | instant |
| Price flip | .25s e | none |
| Scroll reveal | .5s e | shown |
| Map camera | .6s e | instant |
| Hero S rotation | −0.00125 rad/frame, drag .005 rad/px, damping .985 | spin stopped |
| Hover inversion (hero) | .25s e | instant |
| View transitions | `@view-transition{navigation:auto}` | none |

## Philosophy (non-measurable rules)
1. **One protagonist per screen.** Home is only the S; every sub page is one giant word + one tool. Nothing competes.
2. **Type is the image.** Giant condensed uppercase words do the work that cards/icons do elsewhere. Headlines are nouns (RENTAL, PRICE), never sentences of marketing.
3. **Copy is almost absent.** No leads, no explanations, no numbered sections; small factual captions only where needed (equivalent-grade note, tax note).
4. **Black / white tension, square geometry.** No radius, no shadow, no gradient, no tinted surfaces; accent (#668499) appears only to mark "the one selected thing".
5. **Photography is structure.** Official Salomon imagery only, large, cropped hard, never decoration behind text; product shots sit on fog wells.
6. **Information is staged.** Everything lives behind MENU or behind a selector; the price explorer shows one big answer and the rows only for the current selection.
7. **Selection is state, not decoration.** Pressed = inverted black block; rows/values update in place with a short flip.
8. **Chrome disappears.** Edge-set 16px type with difference blending; the page owns the viewport.
9. **Precision utility text.** Labels 13px uppercase, tabular numerals, hairline/2px rules — the "station / base camp" instrument feel.
10. **Energy through scale and motion, not ornament.** Oversized type, asymmetric offsets, wipes and rises with one easing.
11. **Mobile is designed, not stacked.** Sticky selector strips, full-field menu with giant thumb targets, 16px gutters.

## What the LP is NOT (avoid)
cards with shadows, rounded pills, gradients, icons, badges, SaaS dashboard tiles, hotel-style serif elegance, e-commerce grids with prices on cards, long explanatory paragraphs, numbered steps "01 —".
