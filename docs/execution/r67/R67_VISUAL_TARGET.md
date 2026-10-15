# R67 visual target (frozen before implementation)

Authority: Issue #47 R67 plan 6193538884 + design addendum 6193738293.
Quality bar: award-grade editorial (Awwwards / FWA / Webby level) — judged on hierarchy, crop, rhythm,
restraint and motion, never on decoration.

## Hard rules

- No pills, capsules, rounded tabs/steppers/chips/cards, floating pill menus, shadows, gradients or badge noise.
- Rectangles and text links only. Active = underline or weight. Hairlines only where they separate.
- The official logo is the LP raster asset (`logo-stacked-black.webp`, sha256 `d5b7dad0b2db18eb8c8d1cf26d91c2f2dd7bfcdb153b413ccc09376d959dd4ac`), never set in type.
- Every public page puts its title, `BOOK` and a next destination inside the first viewport at 390 px and 1440 px.
- Copy budget: one line under a page title; at most one line under a product. Legal/operational copy only where required.
- FAMILY does not exist anywhere. Children are an age category of each person.

## Component map

| Component | PALACE reference (grammar only) | SALOMON STATION ZAO LP reference | ZAO implementation |
|---|---|---|---|
| Header | — (Palace's pill bar is explicitly rejected) | `.hd`: fixed edge type, difference blend, logo left, `JP EN · MENU` right | Logo image left + small text context `RENTAL` / `BOOKING` (plain caps, not a badge). Right: `JP EN BOOK MENU`; current language/page by weight + underline. Same component on public pages and booking. |
| Full-screen menu | — | `.mnu`: black field, giant asymmetric words, hover crop image, white CTA | Primary `RENTAL PRICES STORES FAQ` giant; secondary `SKI SNOWBOARD PREMIUM WEAR MY BOOKING` small caps row; `BOOK RENTAL ↗` rectangle. Word `MENU`/`CLOSE`, never a hamburger. |
| First view (home / rental) | Home: full-bleed visual + stacked range list + single action | LP hero type scale, Barlow Semi Condensed 700 | Giant `RENTAL`; one line `SKI / SNOWBOARD / WEAR · ZAO ONSEN`; `BOOK RENTAL ↗` (primary black rectangle) then `VIEW LINEUP →`; a category row `SKI SNOWBOARD PREMIUM WEAR PRICES STORES` — all above the fold at 390×844 and 1440×900. Visual is a hard-cropped official Salomon photograph that never pushes the actions down. |
| Lineup | `/ranges`: two-tone title (`RANGE` black + `ARCHIVE` grey), light-grey square tiles, image centred, bottom-left two-tone caption, ~8 px gutters | — | `SKI · REGULAR`, `SKI · PREMIUM`, `SNOWBOARD · REGULAR`, `SNOWBOARD · PREMIUM`, `WEAR` as equal-rank tiles in an asymmetric editorial grid (desktop) / one column (mobile). Unit = IMAGE · NAME (two-tone) · 1 FACT · ACTION. Premium Snowboard tile is typographic (model names WILD CARD / LIBERTY) because no verified model photograph exists. |
| Product / Premium model | Product page: image first, name, minimal spec, price, sizes, one action | — | `MODEL NAME` / `2026/27` / lengths `145 / 150 / 155` / `SELECT MODEL →`. Image only when verified for that model; otherwise typography. |
| Category sub-page (SKI, SNOWBOARD, PREMIUM, WEAR) | Range landing: title first, action immediately | — | Giant word, `REGULAR / PREMIUM` line, `BOOK SKI ↗` etc. in the first viewport. Premium: `CHOOSE MODEL / SEASON / LENGTH` + `VIEW SKI MODELS` / `VIEW SNOWBOARD MODELS`. |
| Prices | Product grid restraint | LP `.tax` two-line note | `PRICES` + `税込` / `前日15:00までの事前決済で5%OFF` + `BOOK RENTAL ↗`, then the interactive table; one optional sentence. No repeated explanation blocks. |
| Pickup / return | Large numerals | LP store terrain | `PICKUP / RETURN`, store switch (MOUNTAIN STATION / CENTRAL STATION) with Maps link, BOOK; then `01 BOOKING / QR · 02 FIT CHECK · 03 PICKUP · 04 RETURN` with big numerals; one timing block. |
| FAQ | Simple full-width rows | — | Full-width question rows with `+`, answer directly below, hard rules, no cards. |
| Booking | Same chrome as browsing | LP header | Header context `BOOKING`; progress `01 DATES 02 GEAR 03 SIZE 04 REVIEW` as text, active = underline/weight. First view: start date, start time, end date, return time, `CONTINUE`. |
| Inputs | — | LP square CTA | Square, 2 px black borders, white/black, active = fill/border/weight. Item choice `SKIS / BOOTS / POLES` as rectangular toggle rows, never chips. |

## Self-check before each screenshot set

1. First viewport (390×844, 1440×900): title, BOOK, category navigation visible without scrolling.
2. Zero `border-radius` > 0 on interactive/content elements; zero `box-shadow`; zero gradients.
3. Logo is an `<img>` of the official asset.
4. Copy: no generic instruction sentences; one line under titles.
5. No FAMILY; Premium Snowboard reachable in ≤1 click from rental lineup and menu.
6. No horizontal overflow; type scale contrast ≥ 3 steps; consistent gutters.
