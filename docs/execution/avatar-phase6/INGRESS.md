# Verified direct Vercel Preview ingress

Official source checked2026-09-16:
https://vercel.com/docs/headers/request-headers#x-forwarded-for
https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for

Vercel documents replacement of incoming generic XFF to prevent IP spoofing, and
its Vercel-specific peer header remaining tied to Vercel ingress when an upstream
proxy alters generic XFF. Phase6 uses only the latter, a single canonical IP,
inside an exact project/branch/preview-environment/deployment-domain composition.
Generic XFF, Forwarded, X-Real-IP and client-supplied identity alternatives are ignored.
The exact deployment URL and Host are checked; localhost adapters remain unchanged.
Actual hosted acceptance must send forged alternative header values and prove that
they cannot create fresh peer budgets. Unit proof alone does not claim provider proof.

Business policy retains owner-balanced-p4:180 peer/1200 global per60s. Avatar uses
avatar-phase6-v1:240 peer/1200 global per60s on the same transactionally locked table.
The distinct version prefix isolates normal image fan-out from business requests.
