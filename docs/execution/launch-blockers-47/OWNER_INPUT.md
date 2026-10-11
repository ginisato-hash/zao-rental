# Owner input packet — status after the Owner decisions of 2026-10-09 (Issue #47 comment 6090166024), updated with the inventory of comment 6103023533

Decided by the Owner (do not ask again): seller/contact, refund policy (online automatic / every active STAFF in store),
the limited live acceptance (1 card payment ≤ ¥5,000, its same-amount full refund, 1 test mail to s_sato@yuge-zao.com,
card entered by the Owner), web use of the SALOMON logo and supplied product photos, and the B4 backup risk acceptance.

| # | Item | Status | What is still needed (facts / confirmation / personal action only) |
|---|---|---|---|
| 1 | Seller disclosure | DECIDED: 株式会社Yuge · 運営責任者 佐藤慎太郎 · 070-4440-4813 · rentalstation@yuge-zao.com · 所在地 〒990-2301 山形県山形市蔵王温泉973-7 (source: https://www.yuge-zao.com/ company profile) | — (store pickup addresses are a separate item, #5) |
| 2 | Terms of use | OWNER_APPROVED JA/EN (`config/content/public-legal.json`, 佐藤慎太郎, 2026-10-09T22:53:05Z, comment 6090629658) | — |
| 3 | Privacy policy | OWNER_APPROVED JA/EN (same record) | — |
| 4 | Cancellation & refund | OWNER_APPROVED JA/EN (same record; the commercial-disclosure document too — all eight texts) | — |
| 5 | Store NAP | Hours 08:30–17:00 for both stores (Owner, 2026-09-10; re-confirmed by TD, comment 6103023533). Central Station (ONSEN_BASE) address DECIDED: 山形市蔵王温泉935-25（ホテル喜らくとなり） / 935-25 Zao Onsen, Yamagata City (next to Hotel Kiraku) — Owner statement 2026-10-02T00:15:19Z, recovered by TD (Issue #47 comment 6102629600); separate from the seller address 973-7 | Mountain Station (MOUNTAIN_BASE) address; phone and access for both stores |
| 6 | Physical stock | Provisional capacity A 901 + B 520 (lower bounds) | Per-store received counts incl. poles, labels/asset IDs, inspection — field fact; not a booking-open condition |
| 7 | Photos & rights | DECIDED: `OWNER_CONFIRMED_WEB_USE`. Logo (`salomonlogos.zip`) and Salomon official photos obtained; derivatives, source hashes and crops in `docs/execution/p85-ui/ASSETS.md` (merged with PR #58) | Product-model photos for Premium pages: model/season/size mapping still to verify |
| 8 | Live acceptance values | DECIDED (see above) | Owner enters the card in person when the technical gates pass |
| 9 | Staff | Every active STAFF may refund (decided) | Named staff accounts and store scopes to create |
| 10 | Real-device acceptance | — | At each store: phone QR scan → booking → assignment → checkout/return with printed labels |
| 11 | Backup B4 / protection | B4 risk ACCEPTED | Monitor notification delivery (currently disabled), natural backup + R2 readback; final Vercel protection removal at launch |
