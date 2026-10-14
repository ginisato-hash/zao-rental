# R64 visible-copy sweep

The scope is normally rendered human UI, including active success, loaded rental, prepared, checked-out and received-return states. Exact internal values remain in closed disclosures or synthetic-only fixture pages. No backend values were renamed.

| Surface | Final treatment | Evidence/test |
|---|---|---|
| Public JA/EN | Customer benefit and usage copy; no CMS/publication-process memo | public-ui, human-ui; public PNGs |
| Booking fields | Person card name scopes labels; no numeric suffix in nested field names | public-ui, human-ui |
| Booking dirty state | Step entry clean; edit warns; revert clears | human-ui |
| Candidate/discount | Human confirmation and 5% payment condition; acknowledgement behavior retained | human-ui |
| Review/payment | Payment total and edit/payment actions; tax basis retained | public-ui, human-ui, tax-display unit |
| Success/save/recovery | Save on this device, confirmation code, secondary recovery panel | activation-p4, booking-recovery-ui, human-ui |
| QR/reservation | Pickup instruction, state/dates/stores/total/QR first | activation-p4, human-ui |
| Premium model | Neutral name and approved photographic fixture; exact fixture inventory remains test-only | capture:model, public-ui |
| Staff home | Compact search; idle camera hidden; operational sections visible | staff-home-ui, capture:staff |
| Rental preparation | Person/equipment labels, short asset references, actual-work BSL prompt | custody-ui, capture:custody |
| Return | Human receipt/inspection states, short return-processing references | custody-ui, wear-ui |
| Holds/recommendation | 仮押さえ・在庫確保 and mapped outcomes | holds-ui, recommendations-ui, recommendation-audit, recommendation-continuation |
| Quotes/prices | Human state/period first; exact price/version IDs closed | quotes-ui, flow-ui |
| Amendment | Human member/product names and closed lookup after load | operations-ui, capture:staff-state |
| Inventory/ledger | Human base fields, short references; CSV keys/source records and exact IDs disclosed secondarily | operations-ui, auth, capture:staff |
| Staff management | Human role/permission labels; enum values submitted unchanged | auth, stabilization-s01, flow-ui |
| Content/photo | Human processing and publication labels; issue codes in details | public-ui, capture:model |
| Ops/launch/notification | Action and human state first; exact technical records in details | operations-console-ui, notification-ui, capture:staff-state |

Automated visible-text scan rejects development/fixture wording, raw status keys, person requirement keys, full UUIDs and primary HOLD terminology. It examines `body.innerText`, so closed disclosures are excluded intentionally; backend assertions still check exact values. Screenshot manifest records the fixture mode and hashes. Production-copy capture does not alter runtime providers or activate commercial payment.

Manual inspection includes staff first viewport, desktop booking fields, Premium mobile model detail, mobile reservation and received-return state. No horizontal overflow or concealed primary action was observed in those inspected renders. First-candidate screenshots and audits remain preserved separately as historical records; they are not counted as current acceptance evidence.

Source review also retained intentional development-only notices behind `ProductionCopy`, test-only booking tools, enum values in option `value`s, and exact raw values inside technical details. These are not mechanically removed by a text search.
