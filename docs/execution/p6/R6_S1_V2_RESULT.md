# P6 R6 S1 Acceptance v2 — blocked before provider dispatch

R6 runtime preflight returned **BLOCKED / API_VERSION_MISMATCH**, HTTP503.
The required value is `SQUARE_API_VERSION=2026-08-19`; the existing configured
value was not read, displayed or saved. S1 was **NOT_RUN** (`S1_BLOCKED`),
with **S1 POST0 / Square GET0**. No merchant/location result or PASS is claimed.
No additional forensic investigation or S1 retry was started.

## Git and deployment

- Starting HEAD: `70cc14921c07ca0513c0b6e17624f69899803517`.
- Authority commit: `78d809b42edc346715b77dbee37e85753bce142f`, pushed/read back
  before implementation or deployment.
- Implementation commit: `2bcd35e7b81f8d5313fb8fff9098639bd8b610de`;
  source tree: `965bfb1793234f5db9e55f8380ccee1d54cb292a`.
- Exact R6 deployment: `dpl_CRdTexvvKm7NRtkas5ewSW6AFQdG`.
- Origin: `https://zao-rental-j2s8mfp77-zao-food-map.vercel.app`.
- Target Preview, Ready, build successful. API raw target null is preserved;
  CLI inspect and authenticated UI independently identify Preview.
- Vercel Authentication **Require Log In checked**, Standard Protection,
  project protection `all_except_custom_domains`, exceptions0, aliases0,
  custom domains0, Production Square env entries0. No protection changes.
- One deployment allowance consumed. No second deployment is authorized.

The local operator used a normal nonpersistent Playwright context and ordinary
Owner Vercel login. Browser credentials were neither read nor exported.
Source upload contained tracked files plus a local `.vercelignore`; the
metadata-only project link, browser data and local operator were excluded.

## Runtime preflight and S1

Observed at `2026-09-14T12:30:53.123Z` from the same authenticated origin.
The preflight factory has no fetch argument or provider composition. Its pure
function returns only flags/enums, and S1 v2 independently repeats that check
before its existing S1 service/transport can run.

| Field | Observed |
| --- | --- |
| environment / deployment | SANDBOX / preview |
| apiVersionMatch | false |
| applicationIdConfigured | true |
| locationIdConfigured | true |
| accessTokenConfigured | true |
| accessTokenFormatValid | true |
| publicCredentialExposure | false |
| readyForS1 | false |
| result / reason | BLOCKED / API_VERSION_MISMATCH |
| S1 POST / merchant GET / locations GET | 0 / 0 / 0 |
| merchant/location HTTP | Not run / not run |
| country, currency, identity matches, CREDIT_CARD_PROCESSING | Not established |

Configured ID flags mean syntax/presence only. Token-format validity is not
provider authentication proof. The local terminal guard
`CLOSED_PREFLIGHT_BLOCKED_NO_POST` was fsynced after the blocked result to close
this scope without reserving or dispatching an S1 POST. It is retained separately
from R4's untouched guard. Historical R4 remains UNKNOWN, POST1, Square count
unknown/maximum2; R6's zero count does not change it.

## Validation and cleanup

Before deploy: **69 tests passed**, fail0/skip0; secret scan, lint, typecheck and
build exit0 on Node24.15.0/npm11.12.1. This includes22 R6 cases plus47 existing
Square-related cases. Four additional local synthetic operator checks confirmed
safe preflight PASS/BLOCKED, structured503 preservation and rejection of extra
response fields. Those checks made no external request.

Result evidence was committed/pushed as
`d4a02fa04bcff2f4463de384d44397df5dcc1eee` **before** cleanup. Both temporary
routes were removed. Post-cleanup **69 tests passed**, fail0/skip0; secret scan,
lint, typecheck and build all exit0. The exact R6 deployment was deleted by ID;
readback lists only accepted R3 `dpl_2tskZombWNMhwEKB6NG96FxkzmhL`, still Ready.
The R6 browser and owned upload staging were closed/removed. R6 terminal guard
is retained and R4's guard matches its original evidence. See
`r6-evidence/cleanup.json` for command times, deletion and readback.

Secret exposure0; Production Square0; payment0; refund0; webhook0; external DB0;
R2 requests0; email/SMS0; S2 execution0; env mutation0; merchant registration0;
new Claude0; Spark0; new PR0; main merge0; Runner0.

## Owner gate

Owner UI correction of Preview `SQUARE_API_VERSION` to exactly `2026-08-19`
and a **separately authorized new Preview/S1 scope** are required. Do not send
any existing secret value to Codex. Vercel documents that env changes apply only
to new deployments, so re-reading or editing code locally cannot update this
already-created Preview. [Vercel environment variable lifecycle](https://vercel.com/docs/environment-variables/managing-environment-variables).

The one R6 Preview allowance is exhausted. No new deployment, env replacement,
provider call or bypass is performed under this result. Merchant metadata and
the S2 gate are not created because S1_PASS was not achieved. R5 was terminated
by Owner as non-gating; its three owned uncommitted drafts were discarded and
no R5 forensic work was resumed.
