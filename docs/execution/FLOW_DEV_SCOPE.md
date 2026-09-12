# ZAO-RENTAL-FLOW-DEV-R1 scope / restart map

PR9 exact approved head f060662206b350a4b26aa653fdc45b04b828fecb was squash merged as
137352fcaa7b28f88aef5100479297f74e64b4aa. Main and merge tree match the approved head tree.
CI34693652278/attempt1 and final review/progress comments were freshly reconciled first.
The old worktree's uncommitted final AUDIT_AG_STATUS.json was separately preserved, matched to
PR9 comment5645938205, and copied here only after the approved-head merge. Prior review records
and Runner policies were preserved. This new branch must remain a Draft PR.

| Original task | Implemented / tested here | Explicit remaining boundary |
|---|---|---|
| E10 | Attempt/key persistence, UNKNOWN lookup, signature and replay, identity/amount matching, immutable quote and HOLD protection | Actual Square transport/Sandbox/external webhook, independent callback identity, production money gate |
| E11 | Existing group input/recommendation/HOLD/quote reused; synthetic contact/private confirmation UI, QR, captured fake notification destination | Real customer access/terms/tax/email, external notifications |
| E12 | Additive unconnected schema and pure exact-cycle/whole-Asset contract | Ordinary reception/assignment/loan/return DB writes, continuous camera UI, location/pole reintegration and permission UI — automatic approval review BLOCKED |
| E13 | Synthetic ordinary password UI→API→real DB through confirmation and QR | Full rental/return loop, Sandbox, physical phone, integrated main merge are NOT complete |

Runtime/test start: `npm run setup`; `npm run test:flow-payment`; after normal `npm run build`,
`PLAYWRIGHT_BROWSERS_PATH=.local/browsers npm run test:flow-ui`. Each test owns its isolated DB,
loopback Next process and browser and shuts them down in finally. No external tunnel/listener.
The test-only composition has no production runtime mode; the normal `npm run dev` payment route
stays unconnected. No development ADMIN with a known/shared password is persisted for humans;
test accounts/passwords are generated and destroyed. A human demonstration launcher/account
bootstrap can be completed after the remaining permission boundary is resolved.

Existing prices/27 reference tests, A-G, same-day intake, within-10-minute continuation, cm case,
full-period/whole-pair allocation, fixed movement and immutable quotes remain regression gates.
The original E09 p95 measurement remains recommendation preview HTTP only, not this whole flow.
See FLOW_DEV_STATUS.json for current head/reviews/budget and FLOW_DEV_BLOCKED_PERMISSIONS.md
for the exact approval stop. No E14, production, Square call, real data, Runner or new service.
