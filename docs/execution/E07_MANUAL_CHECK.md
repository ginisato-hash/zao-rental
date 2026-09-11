# E07 development check

Use this E07 worktree only. No public URL, external tunnel or production DB is configured.
`npm run setup` reproduces locked dependencies. In a human-operated terminal run
`npm run dev -- --bootstrap-admin`. Enter a **synthetic development** ADMIN address/name and a
15–128 character password in the hidden terminal prompt; do not put passwords in chat/arguments.
Open the printed loopback `/staff/login` URL. Each launcher run owns a fresh disposable DB;
records persist through page reload/logout, but are not carried into a new launcher run.

1. ADMIN uses staff management to create a separate synthetic staff account. Assign both stores
   for planning, then explicitly grant transfer view/plan/dispatch/receive and the ledger/HOLD
   permissions needed for the intended test. No role receives transfer rights by default.
   To test separation, another synthetic account may have only the destination and receive rights.
2. The normal launcher does not import real inventory. Create a synthetic model, selected variant
   and an AVAILABLE Asset in Mountain Base through the existing ledger. Use one ski pair as one
   Asset. A pole test uses a POLE variant and a PAIR quantity pool. Tests use traceable fixtures;
   these are not observed stock or the planned 300 combined boards / 200 wear inventory.
3. Open `/staff/transfers`, choose source/destination/date, a staff-confirmed readiness estimate,
   needed-by and a short synthetic operational basis. Select the Asset or pole pair quantity.
   Save the protected plan and inspect the same record after reload. Planning does not move stock.
4. Actual departure is allowed at/after 17:00 on the selected date and explicitly confirms all
   planned items. A departed direction/date batch cannot receive more items or be recreated.
   Actual receipt selects Asset IDs or a pole pair count; readiness is a separate confirmation.
   Partially received pole quantities show the remaining transit and inspection counts.
5. Cross-store or insufficient-permission operations are refused by the server. A lost response
   leaves a saved pending request: reload and use the same-request reconciliation button. Do not
   create a new request to guess whether the prior write succeeded. Logout closes the prior view.
6. Stop the terminal with Ctrl+C. It closes only this launcher's Web and PostgreSQL resources.

For a complete daytime automated demonstration, run `npm run test:transfers-ui` after `npm run build`
(with `PLAYWRIGHT_BROWSERS_PATH=.local/browsers`). It uses the normal Next app, real synthetic
password sessions and PostgreSQL, changing only the clock function in its disposable owner DB.
There is no normal clock-setting or test-auth endpoint. Do not change a live database clock.
Screenshots are under `.local/screenshots/e07-*.png`; 390 px is a simulated width, not a phone test.

An issue remains visible and blocks unsupported promises; there is no automatic issue-clear,
customer cancellation/refund, loan return, scanning or production release. Route/loading/preparation
operational values and actual-staff/device acceptance are not established by these synthetic tests.
