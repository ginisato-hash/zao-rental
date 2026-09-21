# Resumed Phase5 independent finding dispositions

Independent PASS at `e6b97d66598a81c0e26f329e2fd773b954dc746c`. BLOCKER0 / HIGH0 / MEDIUM0 / LOW4.
Original review and severities are preserved in final-review/review.json. No source/artwork change after review.

| ID | Original severity | Independent status | Reason |
|---|---|---|---|
| AV-1 | LOW | CLOSED | Already independently closed at the avatar-phase5 gate (0032's avatar_visual_guard rejects UPDATE of all 13 binding/identity fields). This milestone re-proves the same closed guard against the real imported binding with 13 field-by-field real-PG assertions (tests/avatar/artwork-activation.ts, activation.log lines 5-17), all reviewed in source and consistent with the migration text in 0032_avatar_delivery_boundary.sql. No new binding-mutation surface was introduced; disposition is reaffirmed, not re-decided. |
| AV-2 | LOW | RECORDED_PRODUCT_DECISION_NOT_INDEPENDENTLY_CLOSED | The scoped product choice (zero/ineligible artwork never invents a renderer or fake image) is unchanged in mapAvatarVisualization/avatarLayout and is now demonstrated on both sides of the same milestone: with real approved artwork present (24 ratio measurements, both appearances) and with it temporarily revoked ('AV-2 no eligible artwork means no fabricated renderer; ordinary candidates remain', activation.log). This is a design decision, not a defect, so there is nothing for an independent reviewer to 'close'; it remains recorded as before and is not silently dropped. |
| AV-3 | LOW | PARTIALLY_ADDRESSED_LOCAL_SCOPE_ONLY | The dedicated avatar_read role (unchanged since avatar-phase5) is re-verified against the actual imported real-artwork rows in this milestone: SELECT denied on content_workspace/content_media_objects/content_revision_records/avatar_visuals/guest_contexts/recommendation_previews, no mutation, no DDL, pinned SECURITY DEFINER function with PUBLIC execute revoked and no elevated role flags/memberships (activation.log lines 18-25, 37-42). This remains local-scope proof only; no hosted/Production Avatar role exists or is created by this branch, so the original production-privilege-minimization concern stays open by construction. |
| PHASE4-1 | LOW | CLOSED | Already independently closed at avatar-phase5 (avatar-media-http.ts requires BOOKING_VIEW+HOLD_VIEW+QUOTE_VIEW, matching the staff preview page). Re-confirmed unchanged in this snapshot and re-tested against real imported artwork: all three permissions allow bytes/page, BOOKING_VIEW-only denies both (activation.log; avatar-media-http.ts:4 unchanged). |
| PHASE5-1 | LOW | OPEN_LOCAL_UNTHROTTLED_NO_PUBLIC_ACTIVATION | guest-avatar-http.ts / the guest avatar routes remain byte-identical to avatar-phase5 and still bypass GuestSecurity.guard(); no rate-limit test was added in this milestone. Remains local-development-only (Production still fails closed via avatarRuntime()/publicRuntime() NODE_ENV checks, unchanged). Not addressed, not silently closed. |

## Findings from this review

- **ARTWORK-1 / LOW — Local artwork import transaction sets no lock_timeout/statement_timeout, unlike other repo transactional writers**: Low: this is a single admin-invoked local script against a freshly created, single-writer, non-networked loopback database with no concurrent callers by construction (guarded by rejectAmbientDatabase/worktreeIdentity and the immediately-following per-table emptiness check), so an indefinite wait has no availability blast radius beyond the operator's own terminal. Required proof/correction: A local PG test that holds a conflicting lock on one of the five guarded tables and asserts importLocalArtwork fails within a bounded time rather than hanging. Add SET LOCAL lock_timeout/statement_timeout at the start of the transaction, matching the convention already used by PostgresContentRepository and GuestContexts.change, purely for operational consistency.

No code correction or extra review is required for PASS/LOW-only. Hosted/Production rights and rate limiting remain outside this local acceptance authority. All historical finding records are unchanged.

The reviewer had static code, drawing construction, raster/DOM measurements and hashed evidence. Binary images were not embedded, and the reviewer did not execute tests. Parent visual inspection is separately recorded.

## Factual precision of the unmodified review

The original reviewer response remains verbatim. The following limits prevent overreading
its narrative as additional executed evidence; they change no verdict or severity.

- Drawing source also includes defs/stop/rect elements, not literally only path/linearGradient.
  It contains no external images/references or authored text; the intended conclusion stands.
- Original PNGs were decoded and visually inspected in the source-only intake. The current
  generator verifies their hashes and uses their look as reference, without compositing their
  pixels into the final derivatives. No original PNG is imported or served.
- Codex checked all32 migration hashes against Git. The static reviewer had the32hash record
  and selected full migration sources, not all32 complete texts or tools to recalculate every
  hash. Its statement about direct comparison of all32 files is not an independent hash run.
- The second-import test proves refusal/no change on preexisting content. Partial-write failure
  injection was not tested. Atomic BEGIN/COMMIT/ROLLBACK semantics were inspected in source;
  do not read that test as a simulated mid-transaction failure or contention/timeout test.
- Current PHASE4-1 evidence uses the valid ordinary protected preview entry (without a saved
  staff-owned preview) plus actual approved image bytes. Full permissions allow that entry;
  BOOKING_VIEW-only denies entry and bytes. Earlier full staff renderer proof stays historical.
- All validation ran locally, not remote CI. Reviewer tests_executed=false remains explicit.
