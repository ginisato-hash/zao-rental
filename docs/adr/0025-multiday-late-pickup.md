# 0025: MULTIDAY late physical pickup (owner decision)

2026-09-13. Supersedes only the first-day-only checkout condition in migration0015
and the previous Public P0 pending late-pickup decision. Applied migrations are unchanged.
The historical test “MULTIDAY continuation is not permission for after-hours physical checkout”
still enforces after-hours refusal, not later-day refusal.

Confirmed MULTIDAY bookings may be handed over on later contractual days, strictly before
original due and within 08:30–17:00 at the planned pickup store. Current staff/session/scope,
full-period inventory, exact Premium model/version/length and physical readiness remain required.
AM/PM/DAY and their due times are unchanged. The custody timestamp is actual server time;
commercial start/end/due, snapshot/hash/discounts and HOLD TTL never change. No automatic refund,
repricing, extension, unfixing or first-day no-show release is introduced.

The shared physicalPickupWindow contract applies to wear. The independent existing SQL
checkout trigger enforces matching conditions after locking. Migration0016 is development-DB
guarded, preserves function owner/ACL and changes only the time predicate. No new grants.

Owner also requires NO_PICKUP_COMPLETED when nothing was ever handed over and original due
has passed. The initial privileged release proposal was rejected by automatic approval review, then
the owner explicitly approved the concrete dedicated-DB-only proposal. Migration0017
implements that narrow boundary; no broader authority is implied.
See execution/LATE_PICKUP_BOUNDARY_PROPOSAL.md for the reviewable narrow proposal and blocker.
Do not fake a return, complete a partially collected booking or use a generic service bypass.

Public content will expose an editable latePickupPolicy field stating original price/due remain
and no refund for unused days. Final public wording/terms remain pre-publication approval items.
