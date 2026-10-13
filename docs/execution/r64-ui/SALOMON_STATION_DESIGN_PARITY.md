# SALOMON STATION design parity: LP to ZAO Rental (R64)

**Reference.** The LP at https://salomonstation-zao.com/lp. The measured stylesheet `lp.css` has sha256 86bff742… and is byte-identical to the Owner's LP source, so its values are exact rather than estimated. The full measurement record is `LP_FORENSIC_SPEC.md`, with recovered reference screenshots preserved in the recovery snapshot at 1440, 390 and 768.

**Product screenshots.** See `HUMAN_UI_CLEANUP.md` for the current production-copy captures and receipts. `VALIDATION.md` and `SCREENSHOTS.md` retain the superseded first-candidate record. The recovered captures in `.local/r64/shots/` are historical WIP, not final acceptance evidence. Several staff captures show permission errors or failed API composition. Final captures and their validation receipts are recorded separately.

## System-level parity (all surfaces)

| LP principle | Measured on the LP | How ZAO Rental implements it | Deliberate deviation and reason |
|---|---|---|---|
| Display face | Barlow Semi Condensed 700. Uppercase nouns. | Same woff2 via `--d`; giant nouns throughout | — |
| Body face | Helvetica Neue / Hiragino stack, 16/24 (ja 1.7) | Same stack via `--b`; body 16px, `ja` 1.7 | — |
| Palette | #000 / #fff / fog #CDCCCC / sub #555. Accent #668499 only for "the one selected thing". | Same tokens; `--acc` used only for focus rings on inputs and for the selected marker | Added `--signal` #c8102e. It marks only errors and irreversible actions, and always comes with words. The LP has no error states; a transaction console must flag them, and never by colour alone. |
| Geometry | No radius, no shadow; 2px structural rules; 1px row rules | Same everywhere, including the console. The old 5–10px radii and green/teal surfaces are removed. | — |
| Easing | cubic-bezier(.4,0,.2,1) | `--e`, the single easing | — |
| Gutter and chrome height | clamp(16px, 2.4vw, 32px); header 72/60 px | Same | — |
| Header | Edge type, `mix-blend-mode:difference`, JP/EN + MENU, no pill or logo plate | Same on the public pages, plus a `BOOK` link | The booking action is always one tap away on a transactional site. On /book the header is absolute rather than fixed, so it never overlays form fields. |
| Menu | Full black field, clip-path wipe 0.5s, items rise 0.6s with 0.04s stagger, asymmetric offsets, hover dims siblings, desktop hover image | Same values and motion. Four giant words (RENTAL / PRICES / STORES / FAQ). The categories and utilities are a smaller second tier; a white BOOK RENTAL CTA closes the list. | The rental site has more destinations than the LP. Rather than shrinking every word, the giant tier is kept to four. The old dialog accessibility contract is kept: focus trap, inert background, Escape, focus return, scroll lock. Hover imagery occupies a separate desktop grid area so it cannot hide the category and booking links; those controls remain visible during keyboard focus too. |
| CTA | Square, 56px, Barlow 22, arrow ↗, hover #262626 | `.st-cta` uses the same values. The booking wizard's primary button uses the same geometry with →. | Arrows are pseudo-content with empty alternative text, so accessible names stay exactly the button labels. |
| Selector | 2px-bordered segments; pressed state is solid black | The price explorer, staff recommendation plates and guest size plates all use the same pressed state: solid black. | — |
| Big number | clamp(84px, 9.6vw, 156px) /.82, tabular, flips 0.25s on change | Price explorer, home board, review total, booking result total | — |
| Reveal | 0.5s rise of 18px | `.st-rv`. Content stays visible until the client arms the observer, so it never disappears without JS. | — |
| Footer | One quiet 12px line | A minimal link index followed by the same quiet line | Legal links, MY BOOKING and the staff entrance must stay reachable from every page. |
| Reduced motion | Spin stopped, transitions and animations off | Global transitions and animations off; reveals shown | — |

## Screen-by-screen

| Screen | LP principle adopted | Implementation | Deviation and reason |
|---|---|---|---|
| Home `/ja` `/en` | One protagonist; photography as structure; no copy | **RENTAL DESK.** A hard-cropped official photograph carries one giant sign-plate word, RENTAL. Beside it is a telemetry board: both stations with their hours from content, and day prices read from the price tables. Below that, the booking flow in four words and one BOOK RENTAL. A mobile dock CTA appears whenever the desk CTA is outside the viewport. | **Recovered Claude design rationale.** The rental desk composition retains the interrupted WIP; the rotating S stays the LP's signature. This top shares the DNA (type, rules, square plates, photography) but does a different job: operational and booking-first, the "station/base camp". The recovered implementation uses a noun heading. |
| Lineup (home) | LP RENTAL: asymmetric 12-column grid of 4:5 official images, giant names | Same grid and offsets: REGULAR (S/MAX 8), PREMIUM (QST action photo), SNOWBOARD (ASSASSIN PRO), WEAR (campaign) | — |
| Rental hub | Regular and Premium as a visual comparison | Two plates with the same structure: image, giant name, a promise tag (ANY MODEL / MODEL PROMISED), a definition list, and the ski-set price per day from the tables | — |
| Category pages | One giant noun as the h1; no lead copy | The h1 is the noun (SKI, SNOWBOARD…). An official image beside the facts. Content bullets were rewritten in customer language, with jargon such as 1個体, DIN, HOLD and ブラウザ removed. | Facts stay visible: a booking site must state set contents, the fit check and so on. |
| Prices | LP rates explorer | Same SPORT / AGE / PLAN / DAYS explorer, big answer and rows. Every cell comes from `INITIAL_TABLE`/`WEAR_TABLE`; unit tests compare all 20 products × 11 columns with both the authoritative tables and independently constructed quote inputs. | — |
| Stores | Name as type and a fact list | MOUNTAIN / CENTRAL as nouns. Hours, location and address come from approved content, with Google and Apple Maps links to the building coordinates. | The LP terrain map is not ported. It is an LP asset with its own attribution, and the booking site needs only the facts and directions. |
| Booking `/book` | Same type and plates; one main action | The h1 is BOOK, reduced on transaction pages so the first controls and progress fit the first viewport. The stepper is four words on 4px rules (DATES / GEAR / SIZE / PAY). Fields have 2px borders at 52px with Barlow values. Size candidates are giant-number plates, black when selected. The review leads with the total. The result is a black confirmation plate that replaces the form; details are collapsed. | Native date inputs and selects are kept, because tests and accessibility rely on the native controls. |
| Reservation and cancellation | Same plate language | The same black confirmation plate, with the QR on white beside it. The recovery tools appear only after opening “別の端末で予約を見る”. | — |
| Legal | Facts in rules | Giant LEGAL, the document title, then ruled sections | — |
| Staff and admin | The LP's DNA translated into an operations console | Same type and tokens, 2px rules, square controls of at least 44px. Staff Home order: context → the compact QR/search block (camera preview opens on request) → today's work cards → bookings → tools. Status uses text tags; attention uses a signal bar plus words. | No hero, no giant marketing type, no added navigation. `/admin/launch` must not gain buttons, and test locators depend on the existing structure. |

## Kept deliberately

- Form labels and region names retain their behavioral identity; customer-facing copy changes preserve operation meaning. This includes 'プランを見る' on the booking header.
- Backend enum values and IDs are unchanged. Primary staff UI uses human labels and short references; exact technical values are in closed disclosures. Behavioral tests still verify the server values.

## Takeover corrections

- Distinguish RGB from RGBA in the menu contrast assertion; an opaque black RGB value must not be parsed as alpha 0.
- Keep secondary menu links visible while a main item is hovered or focused. Preserve keyboard, Escape, inert, scroll lock and focus return; add reduced-motion assertions.
- Increase language, booking, menu utility and footer touch targets to 44px; mobile shows the alternate-language action in the compact header.
- Remove hidden mobile-dock links from the focus order via visibility and reserve footer clearance.
- Clarify public wording: availability enables proceeding; it does not by itself confirm a booking. Final amount and discount conditions are checked in the booking screen.
- Normal synthetic behavior retains development notices. A separate test-only production-copy context renders customer wording with fake providers and identifies the fixture in its evidence manifest.

- Cancellation confirmation, viewing/code revocation, transfer-plan cancellation and exceptional refund requests use the signal colour with their explicit action labels. No event handler or permission condition changed.
- Customer English status copy uses “check” / “payment result” instead of internal “reconcile” terminology. A loading reservation no longer shows a synthetic-booking notice before its actual mode is known.

- Reduce the public heading minimum from 84px to 48px so the 17vw display scale fits SNOWBOARD on 390px. A DOM text-range regression checks the actual glyph bounds at 390, 768 and 1440px.

- Ledger navigation wraps with explicit gaps; mobile row actions have a 44px minimum height.
