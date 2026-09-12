# Flow development review 1 and correction record

Review target1e54db6c23312984db2f86ccb267a1bc49dde8ba; snapshot
a21cfe89e97fe319a01ef258499611889c8132789a8e66129a6466847d88b4e6.
Original REVIEW_PASS **with two LOW findings** and evidence limitations is retained at
PR10 comment5646674330 and evidence/flow-dev/review-1-followup/claude-original.json.
This is not a whole-flow PASS and does not authorize E12 rights or real payment.

| Finding | Verification and action |
|---|---|
| Claude F1 clock inconsistency | Real DB: UNKNOWN updated_at used wall clock, not controlled inventory clock (before exit1). Now uses the same transition clock; assertion passes. |
| Implementer FLOW-TIME-1 | Real PostgreSQL ACCESS EXCLUSIVE quote-read synchronization proves a new gateway call could occur after lease expiry (before calls13 versus expected12). Final source validation rereads inventory_clock and rejects before any intent/gateway submission. |
| Implementer FLOW-TIME-2 | Claim-read synchronization proves a successful provider observation could confirm after the original lease cutoff (before CONFIRMED_DEV versus PAYMENT_REVIEW). Confirmation now rereads the clock after claims; leaves manual review/protection, no resurrection. |
| Implementer FLOW-SCOPE-1 | Normal staff account update during pending provider response removes the pickup scope. The old UNKNOWN fallback still wrote UNKNOWN (before expectedPENDING). Its preflight and post-lock recheck now require the saved pickup/return stores; unauthorized fallback preserves SUBMITTING/PENDING protection. |
| Claude F2 receipt order | Valid subpoint: scan must not postdate confirmation. Before: invalid insert accepted. Additive0011 CHECK now rejects it. No existing migration was rewritten and no app-role grants changed. The proposed extra scanned_at<=actual_received_at is NOT in receiptDisposition, which has no actualReceivedAt argument, and would conflate physical receipt with scan time. Keep separate actual receipt (possibly earlier), scan and confirmation. Rollback-only synthetic constraint test demonstrates earlier actual receipt is allowed; not an operational E12 flow. Independent reviewer must assess this partial correction/interpretation. |

The first FLOW-TIME-2 test setup failed because the preceding scope edit invalidated the
fixture's saved authorization context. That log is retained as a **fixture failure**, not the
counterexample. The authority-changing case is now last. The later -02 log is the actual
synchronized CONFIRMED_DEV counterexample. No prolonged wall-clock waits, retries, exception skips or timeout
increases hide a failing assertion; short bounded polls wait for the real PostgreSQL lock state.

## Additional evidence / remaining limits

- A producer fake-provider child exits after creating a receipt whose response is lost. A different
  fresh provider process and fresh BookingService find no durable provider evidence, retain UNKNOWN,
  and do not issue a replacement create even with another key. Children have no DB credential or
  network/model call. This tests actual adapter process loss plus fresh service, **not a full Next
  Web process restart**; that separate end-to-end restart scenario remains untested.
- The prior A-G dirty JSON preservation was checked byte-for-byte against the separately saved copy.
  This is a preservation record, not re-review of all A-G code. Include schema.ts and the sanitized
  preservation receipt in the next snapshot to close the earlier source-material omission.
- Screenshot pixels were visually inspected by Codex and the canvas decoded by jsQR; Claude static
  review did not inspect image pixels. Width assertions and physical phone tests remain distinct.
- Table-only receipt test runs in a migration-owner transaction and ROLLS BACK all loan/candidate/
  receipt fixture rows. No application service, endpoint or role can perform that operation. It
  proves one SQL constraint only; no unauthorized E12 operational workaround is implemented.
- E12 ordinary checkout, continuous scanning, actual receipt, inventory/location/pole reintegration,
  permission management UI and full E13 remain BLOCKED as recorded. Square/Sandbox, customer access,
  real mail/terms/tax and physical phone remain unconnected/unverified. No production payment gate opens.

All fixes are submitted together for a second exact-head static review and CI. New-delegation
starts consumed1/8 before that submission; old A-G/E09 usage remains separate.
