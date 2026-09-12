# ADR 0016 — Supervised recommendation, selection, HOLD and quote

Owner authority: 2026-09-12 continuation, including intentional public repository visibility for
supervisor audit. PR #8 exact head fac4fbd9556d26b8a50c1bf98925c44ccb5e841e was reviewed/CI verified
and squash-merged as 7caf8cea4af29bb0d07ed3a55838257d8a9ffe5c. E09 is a new worktree from that main. PR3 remains Draft and
UNATTENDED_HOLD is unchanged. The current deadline is 2026-09-12T06:04:53Z, measured from
02:04:53Z, including the visibility-confirmation pause. No scheduler or Runner is used.

Business source: RECOMMENDATION_ENGINE.md, INVENTORY_RULES.md, existing E06–E08 contracts and the
owner's current E09 task. No alternate sizing formula, stock counts, pricing engine, transfer or HOLD
is created. The original source/configuration and applied migrations 0001–0006 remain unchanged.
The new migration 0007 adds immutable recommendation previews, immutable selected conditions with
append-only stage history, and references to the existing HOLD and quote records.

The one versioned sizing implementation lives in contracts/recommendation.ts. The exact input JSON
Schema forbids unknown fields. Ski retains declared weight/age-at-start/level, while snowboard
requires only height/foot size, the explicit 13-at-start category and class. Switching sports removes
obsolete input. Numeric bounds are defensive input limits, not a fitting or safety qualification.
Numeric centimetre catalog text is parsed strictly; unknown text is excluded rather than guessed.
Boots are exactly the initial requested +1cm size; no neighboring-size fallback. Pole variant is an
explicit existing size/age/class selection, in pairs. No automatic pole formula, inferred BSL or DIN.

Each candidate contains the complete set, not just its board. Actual variants in the selected age,
class and original absolute window go through HoldService.availability (including E07 projections).
The ranked feasible lengths follow the source's nearest-target/shorter-tie rule. SHORTER/LONGER
remain relative to the initially recommended length, never the last button. No new model-guarantee
commercial policy is activated: the private UI explicitly discloses no named model promise and
requires acceptance of the exact shown size/class variant set. Every eligible same-size catalog key
is retained, up to the existing six-variant contract; larger sets are INDETERMINATE, never truncated.
Actual model guarantees and a public customer selection flow remain pending owner decisions.

Preview uses existing E08 calculation and book selection read-only, without saving or reserving a
quote/coupon. The card amount is explicitly undiscounted advisory context, not a future price lock.
Recommendation previews save input, original target/window, rule/model version, offered variants,
initial recommendation and (later) chosen direction. These may contain body data in future use;
this task uses synthetic profiles only, excludes actual body data from logs/review, and exposes
records only through fresh authenticated owner/store-scoped APIs. No public booking endpoint.

The service requires existing HOLD_VIEW + QUOTE_VIEW; selection/recovery additionally requires
HOLD_EDIT + QUOTE_CREATE. No new permission is silently granted. Store authorization is re-read
before work and before locking. The new app DB role has its own connection, cannot read credentials
or write stock/HOLD/prices/quotes/staff or mutate history, and calls domain services through their
existing separate pools. No migration credentials enter the Web process.

One persisted selection per immutable preview commits its intent and randomly generated stable
HOLD/quote keys before either domain operation. A PostgreSQL try-advisory transaction lock keyed
by preview serializes recovery; concurrent callers get OPERATION_IN_PROGRESS rather than launch
another operation. The outer transaction only tracks orchestration; HOLD and quote have independent
commits by design. A crash or response loss replays saved keys through existing idempotency, including
when HOLD or quote committed but the tracking update did not. Quote failure leaves HOLD_SAVED and
never creates another HOLD. A terminal feasibility refusal is preserved; new selection needs a new
preview. A completed result is re-read, not re-executed. Ordinary refresh/retry cannot renew TTL.
The implementation follows PostgreSQL's [transaction advisory lock lifecycle](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS)
and [Read Committed visibility](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED).
Each domain takes its own original lock order; no code holding an inventory/pricing lock calls back
into the orchestration service. Lock acquisition/pool/statement limits return indeterminate errors.

For amendments a preview saves the observed HOLD version. An optional expectedVersion guard in
HoldService checks it inside the existing inventory transaction, after idempotent-result lookup.
Thus a replay of a committed action still recovers, but another tab's stale different action cannot
overwrite the new HOLD. Failed amendments preserve the previous conditions, claims and expiry.
The group is revalidated atomically by the original solver; individually feasible cards never imply
group feasibility. On group failure all potentially affected members remain visible with the saved
choices; staff must request fresh candidates. No automatic substitution or automatic transfer.

Quotes come from the server-read successful HOLD. Selected-condition equality is checked again;
E08 verifies current HOLD content under its own inventory lock. Physical witness reshuffling with
unchanged selected variants does not change a selection or amount. If conditions changed, an earlier
quote cannot be displayed as the price of the edited input; inputs invalidate the visible result,
and readback identifies HOLD drift. Persisted amounts themselves never change. All E08 production
gates remain: tax, production dates/TTL and real coupon terms unresolved; redemption/lifetime limits,
price publication approval, booking/payment/AmendmentQuote not implemented. chargeReady=false.

UI components stay under staff authentication but accept ordinary typed props for later reuse.
Per-session pending envelopes save exact idempotent requests before sending; storage failure stops
mutations. Inputs may supersede an outstanding advisory preview (no stock effect); generation and
unmount guards discard its late response. Pending selection/recovery blocks new mutations until
reconciled. Session boundary, no-store responses and fresh permission checks remain mandatory.
Screenshots are desktop/mobile browser widths, not physical-device validation.

Bounded development limits: 20 members, 2000 catalog variants, 32 lengths/member and120 complete-set
candidate checks/request, plus original E06 solver limits. Over-limit/timeout is INDETERMINATE and
must not be marketed as sold-out. Preview checks are sequential point-in-time advisory evaluations;
a later candidate may see a newer committed inventory state. Final atomic group HOLD is authority.
Load evidence uses exactly150 ski pairs +150 boards with300 boot pairs and150 pole pairs, all labeled
SYNTHETIC. E09 HTTP measurements include login-session validation, DB reads/solve, price lookup and
preview persistence, not isolated CPU/DB timings and not inherited E06 measurements.

Initial independent static review (head8cfbc7aa0ee21501694b72071ae6589c9ef4ba51) returned REVIEW_PASS
with LOW E09-01: an unavailable direction still displayed the member's reference amount. The normal
UI regression first reproduces that display error, then checks missing LONGER at height200/target180
(recommended166cm) and missing SHORTER at height149/target129 (recommended134cm) against the actual
synthetic catalog. Only cards with an actual candidate now show price or price-error information.
HOLD, inventory, sizing, discount arithmetic and authorization are unchanged. A fresh review and CI
must target the amended head; the first PASS does not mean the LOW was already resolved.

## E09 audit followup: new intake is not the product start timestamp

The owner-authorized audit reproduced DAY10:00, AM10:00 and PM14:00 as successful
recommendation/selection/HOLD followed by RENTAL_ALREADY_STARTED in quote creation.
`newIntakeWindow` in the existing HOLD contract now shares the new-request acceptance check
between availability, HOLD create/amend and quote preview/create. It uses OPERATIONS.md:
on the first Tokyo date AM closes12:00, other products close17:00; a start date already past
is refused, including MULTIDAY whose return is still future. Future bookings remain accepted.
This does not implement physical handoff or open the shop before08:30: online staff planning
ahead of pickup remains possible. PM earliest pickup remains13:00; the12:00–13:00 gap is not
a new closure. Late first-day MULTIDAY intake is bounded by shop17:00, not its last return date.

Product startsAt/dueAt and WHOLE_TOKYO_DATE_V1 occupancy remain unchanged. New quotes made
before product start keep the existing start-time bound. At/after start, while intake is open,
their time bound becomes that day's intake close. Expiry is still the minimum of that bound,
quote TTL, linked HOLD expiry, coupon expiry and estimated early-discount cutoff. Existing
HOLD600-second leases, amend/retry non-extension and immutable stored quote hashes stay intact.
A near-close HOLD can retain its original lease beyond intake close; that lease never authorizes
a new after-close request or a valid after-close newly-created quote. It is not a checkout promise.
Idempotency lookup still precedes new intake validation; original saved results can be reconciled
after a clock boundary without generating new keys or renewing expiry. Operational reassign keeps
its existing full-period/state/payment checks rather than treating it as a new booking intake.
No clock value is added to conditions/fingerprints. No migration or canonical price edit.

The cm parser now accepts case-insensitive explicit cm, matching the ledger's case folding,
and retains its existing whitespace allowance between a contiguous number and cm (and edge trim).
This is lexical spelling compatibility: no unit conversion, missing-unit guessing or joining split
digits/letters. Ledger supports other size text, but that does not make it a numeric recommendation.
Height-20±15, foot+1, exact age/class and explicit model-policy acceptance are unchanged.
Normal authenticated ledger registration tests verify actual candidate variant IDs for cm/CM/Cm,
tabs/spaces and26.5, and exclusion of150/M/150mm; preexisting lowercase variants cannot mask a failure.

Known A-G findings remain OPEN under E09_AUDIT_FOLLOWUP.md. Their old dependencies are not fixed by
these two corrections or by a scoped static review. Merge readiness and production readiness are
separate decisions; both require the outstanding gates, and neither is authorized in this task.
