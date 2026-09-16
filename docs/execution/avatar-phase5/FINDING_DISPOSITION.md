# Phase5 independent findings and dispositions

Independent verdict **PASS** at implementation/evidence HEAD
`4f1aadc07cfcdb3f42f84a8cc918d714ef1ba985`.
BLOCKER0 / HIGH0 / MEDIUM0 / remaining LOW3. Original [review.json](final-review/review.json)
is preserved unchanged. Initial review1, correction0, retry0. No source change after review.
Historical review files/severities remain unchanged; only the Phase5 assessment below is new.

| ID | Original severity | Independent disposition | Evidence / remaining boundary |
|---|---|---|---|
| AV-1 | LOW | CLOSED | 0032 rejects UPDATE of all13 binding/identity fields with23514; field-by-field real PG tests. State/sort/normalized presentation remain mutable; no writer/editor route. This closes the original UPDATE finding, not a claim against a trusted DB owner who can change schema. |
| AV-2 | LOW | RECORDED_PRODUCT_DECISION_NOT_INDEPENDENTLY_CLOSED | Zero approved/eligible artwork means no renderer and no fake art. Explicit product choice retained; counts among remaining LOWs. |
| AV-3 | LOW | PARTIALLY_ADDRESSED_LOCAL_SCOPE_ONLY / OPEN | Dedicated local avatar_read role now reads only eligible metadata/derivatives and cannot read workspace, raw media, revisions, business rows or write. Historical general content_read is unchanged. Hosted/Production privilege design remains pending; no hosted role was created. |
| PHASE4-1 | LOW | CLOSED | Staff page and bytes both require BOOKING_VIEW/HOLD_VIEW/QUOTE_VIEW. Exact BOOKING_VIEW-only, each individually missing permission, and positive full-permission PG/browser cases pass. |
| PHASE5-1 | LOW | OPEN | Guest Avatar metadata/media have no GuestSecurity rate limiter. They remain authenticated, scoped, bounded and local-development-only; Production fails closed. Before non-local exposure, add the appropriate trusted-peer/global limiter and request-volume proof. No volume-budget test was run in this milestone. |

PHASE5-1 is explicitly an absence of throttling, not an authorization exemption: guest
context/owner/draft/member/offered-visual/current-rights checks remain mandatory. No
public activation, new service, provider request or extra review is triggered by this LOW.
No LOW is silently removed or downgraded. AV-1/PHASE4-1 closure is the actual independent
reviewer's decision; the parent does not independently close AV-2/AV-3/PHASE5-1.

## Factual precision of the preserved static review

The original review remains verbatim. The actual narrow local role is LOGIN (needed for
its dedicated localhost connection), with NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/
NOREPLICATION/NOBYPASSRLS and no memberships; the review's phrase “NOLOGIN-safe” is not
an assertion that rolcanlogin=false. CSP sandbox is attached to successful image responses;
JSON/empty responses share private/no-store/nosniff/noindex headers but do not add CSP.
The new exact-PREMIUM PG test proves valid matching lookup/filtering and a wrong-season
insert rejection; other relation rules are inspected code and related mapper tests, not
an additional claim that this PG test individually mutates every relation field.
All tests ran locally, not remote CI. These clarifications change no code, verdict or
original finding severity; they prevent overreading narrative summaries as test evidence.

Normal terminal: **PHASE5_CODE_PASS_ARTWORK_INPUT_REQUIRED**. Approved real artwork is
still NOT_PROVIDED. Next input requires provenance, rights approval, proper layer/artboard
and immutable purpose/release binding. No automatic hosted or public activation.
