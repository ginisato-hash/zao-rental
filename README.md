# ZAO Rental Platform Bootstrap v0.4

Two-store rental-system design handoff. Specifications, draft configuration and local seed validation only; not a deployed application.

## Owner update implemented in this package
AM08:30–12:00; PM13:00–17:00. Initial no same-date re-rental, with a future policy path for 60-minute-gap AM-to-PM operation. Customer recommended/shorter/longer selection. Daily staff stock movement from17:00 between Mountain Base and Onsen Base (approximately10min driving). Early return has no automatic refund; selected staff may receive audited exception-refund authority.
Prices are unchanged: the original v0.3 pricing JSON is preserved byte-for-byte. Pricing remains unpublished pending tax/effective-date confirmation.

## Read first
- docs/DECISIONS_v0.4_JA.md — owner-facing summary
- docs/OPERATIONS.md
- docs/INVENTORY_RULES.md
- docs/RECOMMENDATION_ENGINE.md
- docs/REFUND_POLICY.md
- docs/STATE_MACHINES.md
- docs/OPERATIONAL_ACCEPTANCE.md — required runtime tests, not executed here
- config/operations/zao-ops-v1.draft.json

## Local validation
```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
```
Checks pricing arithmetic and operational configuration/document consistency only. Does not prove a booking UI/API, database isolation, concurrent allocation, actual QR scanner, scheduled transfer app, Square payment/refund integration or production performance exists. See docs/BOOTSTRAP_TEST_RESULT.txt for the actual local test log.

No repository push, external model delegation, live Square action or deployment is performed by generating this package. Architecture remains a review candidate, not a final freeze. See docs/OPEN_QUESTIONS.md for production gates that do not block independent foundation work.
