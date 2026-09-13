# Human-operated development preview

Worktree: `/Users/gini/Projects/zao-rental/.local/worktrees/public-p0`.
`npm run setup`, then `npm run demo:public` from a human terminal. This is an explicit
synthetic test composition, not the normal production app. It starts fresh isolated PG
and Web bound to127.0.0.1, asks for a disposable password without echo, and prints only
the local URLs and synthetic account identifier. Use no real customer/staff data.

Open the printed `/ja/book` (or `/en/book`), dates2035-01-05 and later, Regular ski/board,
170cm height/25.5cm foot, ski pole110cm. Check the candidate, whole-group estimate and
synthetic contact. Only the final test-payment step obtains HOLD/quote. Reload returns
the same saved result. No Square is called. There is no real charge/production booking.
The demo clock is fixed2035-01-01, so deadline/late-pickup changes are automated-test
scenarios, not promises that this fixed-clock demo implements real-time expiry.

`/staff/login` uses the separately identified synthetic demo account and the typed
password. Real staff accounts are not created or granted rights. For model/wear/content
UI evidence use `npm run test:public-ui`; those fixtures explicitly seed synthetic rights,
Premium lengths and garment quantity through the existing registration services.
Manufacturer/shop/rights verification is not complete for real products. No real stock
or200-garment distribution is inferred from these fixtures.

Ctrl+C stops only this app's DB and Web. No service or restart job is installed. The fresh
DB retains data through browser reload/logout within that run, not a new demo startup.
Normal `npm run dev` remains the existing restricted app; new guest/content connection
roles must be composed intentionally, and production will not accept the test adapter.

Automated verification:
- `test:public-guest`: distinct guest capability,20people,wear/mixed Premium,total/version
  changes, replay, no early HOLD, strict inputs/analytics (actual isolated PostgreSQL).
- `test:public-content`: PostgreSQL draft/release/photo history, rights, exact lengths,
  least privileges and lock-wait permission revocation.
- `test:public-ui`: initial JA/EN HTML/SEO, ordinary guest flow, response loss, scoped
  staff delayed pickup, ordinary content/photo UI, model withdrawal/media/410/redirect.
- `test:late-pickup`: owner late pickup/no-pickup contract including gear/wear and audits.
- `verify`: existing regression suite plus these checks, lint/typecheck/build.

Screenshots use desktop Chromium and390px viewport; no real smartphone/camera/CWV field
measurement is claimed. Reusable metadata/analytics contracts are not Search Console/GBP
or analytics-provider connections. Production indexing remains disabled.
