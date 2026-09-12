# E09 human development check

Use this task's dedicated worktree, with Node/npm versions already pinned by the repository.
Run `npm run setup`, then `npm run dev -- --bootstrap-admin` in a human terminal. Enter the chosen
synthetic development ADMIN email/password through that terminal's hidden password prompt; never
paste passwords, tokens or cookies into chat. No real staff/customer/body data for this task.
The launcher binds only loopback and starts a new disposable, worktree-owned PostgreSQL database.
Do not use another project's process or a production connection. Ctrl+C stops this Web/DB only.

1. Log in at the printed loopback /staff/login URL. Create a separate synthetic price ADMIN with ALL
   scope and explicit QUOTE_VIEW/QUOTE_CREATE/PRICE_EDIT. The initial administrator cannot grant itself
   rights. Create a synthetic staff account with intended stores and explicit HOLD_VIEW/HOLD_EDIT/
   QUOTE_VIEW/QUOTE_CREATE. Existing inventory permissions are separately required for ledger setup.
2. Register small synthetic models/variants/assets and pole pair quantities through the existing
   ledger workflow. Include exact cm text, correct age/class, boot variants and all set components.
   The standard dev launcher does not seed test accounts or expose fixture endpoints. For ski boots,
   unknown BSL remains UNVERIFIED. Do not invent measured BSL.
3. The separate price ADMIN opens /staff/quotes and explicitly initializes the approved source price
   copy with a chosen development date range. This does not publish prices or establish real season dates.
4. Log in as the scoped staff user and open /staff/recommendations. Fill synthetic group inputs,
   including ski declarations and manual pole selection. Board needs no weight/level/exact age.
   Preview shows advisory candidates; choose a direction for every member and accept the disclosed
   size/class/no-model-promise policy. Optionally request an early-discount estimate or synthetic coupon.
5. Submit the group HOLD + quote. Read the saved HOLD, quote, validity and timestamps. Refresh or log
   out/in to reopen your saved preview. Data persists during the same app run. Restarting the disposable
   launcher creates a new database; it is not a production persistence setup.
6. To amend, keep the saved HOLD linked, edit conditions, request a new preview and explicitly select.
   Its original expiry does not extend. A failed amendment keeps the original valid HOLD. Inspect saved
   conditions; no automatic size/class replacement occurs. For a genuinely new group, reload the page
   without opening an old saved preview; cancelling an old HOLD is the existing /staff/holds operation.
7. If response is unknown, use the same-request reconciliation button; do not open a new group to retry.
   If only quote failed, use saved HOLD/quote reconciliation. Resolve the indicated missing pricing or
   coupon configuration through authorized procedures. An expired HOLD requires separate fresh validation.

`npm run test:recommendation` uses an isolated real database and synthetic records.
`npm run test:recommendations-ui` uses the built normal app, generated test passwords and actual API/DB.
`npm run verify` builds before that UI test and saves command logs. Screenshots and new HTTP benchmark
are under .local/screenshots and .local/benchmarks, and are included in CI evidence. Browser traces/
cookies/passwords are not retained. A viewport test is not a physical smartphone test.

All quotes remain private estimates, tax unconfirmed, early discount provisional, chargeReady=false.
No customer publication, payment, Square, real transfer dispatch or checkout/return is required here.
