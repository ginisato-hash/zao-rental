# Public guest boundary — owner explicitly approved

The owner answered “専用開発DBのguest分離案を承認”. The initial rejection below is
historical; implementation is limited to this exact dedicated-development proposal.

Automatic approval review rejected a combined implementation because it changes permanent
identity references across inventory, price, booking and audit plus service/DB permissions.
Guest separation is approved as a product feature, but this specific cross-domain DB boundary
needs explicit confirmation. No rejected migration, role or service change has been applied.

Dedicated synthetic development database only, guarded by current_database() ^zr_[a-f0-9]{12}$.
Preserve all existing IDs, rows, owner equality checks, immutable history and applied migrations.
No main/prod migration, real data, OS/GitHub privilege change or public deployment.

1. Add booking_actors(id,kind STAFF|GUEST), backfill existing staff IDs; new staff insert trigger
   registers only that staff ID. Guest context uses a separate guest_ID, no staff_members/auth_user.
2. Add guest_contexts: random256-bit cookie credential, SHA256 only stored, fixed expiry/revocation;
   guest_drafts: one per context, revision/CAS, server-owned preview/selection/booking request IDs.
3. Replace only these14 foreign key targets from staff_members to booking_actors, with full
   validation and unchanged columns/values: inventory_reservations.owner_id, inventory_holds.owner_id,
   inventory_requests.owner_id, inventory_history.actor, inventory_replans.actor, price_quotes.actor,
   coupon_reservations.actor, pricing_history.actor, recommendation_previews.owner_id,
   recommendation_selections.owner_id, rental_bookings.owner_id, rental_payment_attempts.actor,
   rental_requests.actor, rental_history.actor. No FK removal without replacement. Staff-only price
   book creators and physical custody/return/management actors stay referenced to staff_members.
4. HoldService/QuoteService/RecommendationService accept a distinct typed GuestActor proof,
   validated from context record at each existing authorization boundary. Staff branch retains
   current role/revision/scope/permission checks. Guest can only owned draft/HOLD/private quote/
   simulated booking; never PRICE_EDIT, inventory edit, staff management, transfer or custody.
5. BookingService accepts separate guest context identity (not a fake staff session). For guest,
   ownership is mandatory even in staff handoff/list methods. Custody rejects all guest actors.
6. Existing hold/pricing/recommendation server DB roles add SELECT guest_contexts/booking_actors
   only. New server BFF guest role: CONNECT/USAGE, SELECT+INSERT registry/context, UPDATE revocation,
   SELECT+INSERT+UPDATE guest_drafts, clock read. No memberships, owner/DDL, staff/table mutation,
   physical inventory, price configuration or payment write privileges for this guest DB role.
   Domain writes remain in existing scoped server services, never SQL capabilities in the browser.
7. Read-only current-context proof for simulated payment uses the guest pool; staff uses the
   existing auth pool. Test provider remains isolated from production; chargeReady=false retained.

Required proof before adoption: fresh migration and prior-prefix upgrade with preserved rows,
actual PG guest-vs-staff/cross-guest/expired/revoked/tampered flags, no fake staff row, no forbidden
role/DDL/price/location write, concurrent draft/HOLD replay, original staff/A-G/custody regressions.
No unauthenticated admin flag, dropped owner check or workaround around this rejection.

Independent SEO/SSR/content contracts and late-pickup verification continue while this is pending.

## Owner resolution

The owner explicitly approved this dedicated development DB proposal in the current session.
The original rejection is preserved above as history. Scope remains synthetic development only.
