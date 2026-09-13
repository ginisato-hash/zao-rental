# Exact no-pickup completion boundary — owner approved

Approval update: the owner explicitly answered “専用開発DBの限定案を承認”.
The earlier rejection below remains historical. Migration0017 implements only this approved proposal.

The owner requires no-pickup completion after original due with no refund or fake return.
Automatic approval review rejected the proposed implementation: a new SECURITY DEFINER
function and permanent booking/claim write grants were not sufficiently authorized/guarded.
This rejection is preserved; no indirect service or migration bypass is permitted.

Concrete proposal for a dedicated synthetic development database only:
- Migration guarded by current_database() matching ^zr_[a-f0-9]{12}$ and existing custody roles.
- New append-only rental_no_pickup_events keyed by booking_id, actor, original due, actual server
  completion time, outcome NO_PICKUP_COMPLETED. No contact, token or session value recorded.
- One UUID-only rental_complete_no_pickup(uuid), fixed search_path pg_catalog,public,pg_temp,
  owner existing non-login custody_executor; PUBLIC EXECUTE revoked, existing custody role only.
- Reuse inventory lock71820600 and existing live session/BOOKING_VIEW/RENTAL_CHECKOUT/pickup
  store check, rechecked after waiting. Unknown/not confirmed/not SUCCESS/not ACTIVE rejected.
- At or after original due, and only if NO equipment loan and NO wear loan ever existed, release
  only that booking's active inventory_claims/wear_claims; underlying hold becomes RELEASED,
  booking COMPLETED_DEV, append the no-pickup event atomically. Fixed-stage history, transfer
  facts, conditions, price snapshot/hash, discounts, due and original HOLD expiry are unchanged.
- Existing executor's extra grants would be SELECT wear_loans/wear_claims/new event;
  INSERT new event; UPDATE(active) wear_claims; UPDATE(state,version) rental_bookings/holds.
  Existing custody application gets only SELECT new event and EXECUTE this UUID function,
  never direct writes to booking/claims or table owner membership.
- Same-booking replay is idempotent after fresh authorization. Partial collections rejected.
  Explicit staff command, no scheduler. UI pending closure until authorized reconciliation.
- Required tests: due boundary, partial wear/equipment, concurrent checkout/closure, scope/session
  revocation after lock, hostile schema, replay, immutable amounts/dates, no payment/receipt calls.

The new permanent execution/grant boundary needs specific human approval if retained. Existing
late-pickup changes proceed with unchanged role/ACL; Public P0 independent work continues.

## Owner resolution

The owner explicitly approved this dedicated development DB proposal in the current session.
The original rejection is preserved above as history. Scope remains synthetic development only.
