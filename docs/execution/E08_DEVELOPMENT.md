# E08 local operation (not production)

Use a human terminal in `/Users/gini/Projects/zao-rental/.local/worktrees/pricing-quote-e08`.
Run `npm run setup`, then `npm run dev -- --bootstrap-admin`. Enter a chosen development email/name
and a 15–128 character password at the hidden terminal prompts; never paste credentials into chat.
The printed loopback URL opens `/staff/login`. No LAN/tunnel/public URL is created. This launcher
owns a fresh isolated PostgreSQL cluster and uses separate auth/ledger/HOLD/transfer/pricing DB roles.
Records survive reload and logout/login during the run; restarting the disposable launcher creates
a fresh DB. Stop it with Ctrl+C and confirm the owned DB/Web exit. No existing service is stopped.

1. Initial ADMIN logs in and opens `/staff/users`. Create a separate development ADMIN with explicit
   ALL-store scope and QUOTE_VIEW, QUOTE_CREATE, PRICE_EDIT. Self-privilege editing remains prohibited.
   Create an individual STAFF with assigned stores, QUOTE_VIEW and QUOTE_CREATE (and HOLD_VIEW /
   HOLD_EDIT only if HOLD integration is to be tested). These are deliberate local operator actions;
   no real account has been assigned privileges by this implementation session.
2. The price ADMIN logs in and opens `/staff/quotes`, enters development rental dates, then explicitly
   initializes the private copy of the canonical source table. This is not production activation.
3. STAFF logs in. Existing ledger variants must be registered through the ordinary ledger UI by an
   authorized inventory editor. Automated tests instead seed clearly SYNTHETIC variants in tests only.
   The normal app has no fixture/seed/auth-bypass endpoint. Product class and size must match actual
   ledger variants, and a quote does not assert that an Asset is currently reservable.
4. Choose product(s), individual sizes, dates/slot, stores and optional early estimate/coupon. Save,
   open detail, reload, logout/login and read the same quote. Changing input requires a new quote.
   A linked own HOLD can supply exact group conditions; a later mismatch refuses a new linked quote.
   Draft/available price state, version, expiry and pending tax remain visible; no charge is possible.
5. If a write response is lost, use “同じ要求を照合・再送”. New writes stop until the same key is checked.
   Browser storage unavailable, session changes or permission removal close/stop the operation.

Automated validation: `npm run test:pricing` starts/stops its own actual PostgreSQL; `npm run build`
then `npm run test:quotes-ui` starts the built normal app and browser with synthetic password accounts,
uses a controlled DB clock and stops all owned resources. `npm run verify` includes both and all prior
regressions. It does not send model requests. Screenshots under `.local/screenshots/e08-*` contain
synthetic data and browser viewport simulation only, not physical phone acceptance.

Production, real staff/customer onboarding, Square, email provider and coupon redemption are not
connected. Never copy runtime credentials, cookies or raw authentication traces into reports.
