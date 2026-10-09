# Owner input packet — the only items that block publication and that code cannot supply

Fill once (reply in Issue #47 or hand the files over). Nothing here is invented by the implementer.

| # | Item | What exactly | Where it lands |
|---|---|---|---|
| 1 | Seller disclosure (特定商取引法に基づく表記) | Legal seller name, representative/responsible person, address, phone, contact email, payment methods/timing, delivery (pickup) timing, cancellation/return terms reference | `config/content/public-legal.json` `commercial-disclosure` (JA/EN) |
| 2 | Terms of use | Owner-supplied or Owner-approved JA/EN text | `terms` |
| 3 | Privacy policy | Operator, data collected (name, email, booking data), purposes, processors (Square payments, Resend mail, Vercel/Neon hosting), retention, contact | `privacy` |
| 4 | Cancellation & refund wording | Approve JA/EN wording of the rule already in force (≥48 h before start: full refund; later: no automatic refund) | `cancellation` |
| 5 | Store NAP | Official address, phone, opening hours, access for MOUNTAIN_BASE and ONSEN_BASE | `config/content/public-p0-pages.json` store pages |
| 6 | Physical stock | Per store: received counts by item/size (incl. poles), asset IDs/labels, inspection result, BSL where known | stock import (`launch-critical-m2b/stock-import-template.csv`) |
| 7 | Photos & rights (optional for launch) | Files, rights holder, permitted public use, model mapping. Without it Premium stays unlisted; Regular can launch | rights manifest |
| 8 | Live acceptance values | One card + booking for one live charge, one refund and one confirmation mail: JPY ceiling, recipient address, message count; then the worker limits to open (notification/refund count, refund JPY budget) | approved production env + one live chain |
| 9 | Staff | Named staff accounts with store scope and permissions (incl. who holds REFUND_OVERRIDE) | staff admin |
| 10 | Real-device acceptance | At each store: phone camera QR scan → booking → assignment → checkout/return with printed labels | acceptance record |
| 11 | Backup monitoring (B4) and final protection switch | Accept GitHub-schedule limits (PR #56 OPERATING_GATE.md) and, at the end, remove Vercel deployment protection | Owner action |
