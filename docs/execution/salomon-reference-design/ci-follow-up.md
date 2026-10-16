# Production fixture expectation correction

Natural Foundation run `38897715394`, attempt 1, checked out
`fac75cdb0371f4e9d7653997d2b8e0f18669a80a` for PR 68 head
`15d947a2740dd96e58afd0b549a164fde94a6180`, tree
`7ec2679368578c14fce8b6d0f72331e78afe695c`.
The first 73 verify commands exited 0, including the new avatar browser test.
Command 74, `test:production-runtime-ui`, failed its final check; the last three
commands did not run and runner simulation was skipped. This is not a CI PASS.
Unit evidence is 1,151 passed, four existing platform skips, zero failed.
Artifact 12046851574 was preserved and its ZIP SHA-256 matched
`76fb55b9fa9523f700a22299aa83529dcb46e9a99db000045f0ece30aafb0c1a`.

The old candidate-screen assertion required zero avatar stages whenever private
artwork capability was disabled. The new bundled public reference is independent
of that capability. A local reproduction logged exactly one stage, then failed
the original zero expectation. The confirmed-booking screen still requires zero.

Only the final fixture check and its shared decode-helper import changed. It now
requires one stage, one person image and one ski image, actual WebP decoding,
static public paths, and zero private-image requests during rendering. After that
observation window, explicit fresh-draft private metadata/media probes must still
return 404. Checkout remains 503; the existing business-data fingerprint must be
unchanged and external requests remain zero. Product code and test timeout are
unchanged. No warmup, retry, skipped check or extra business POST was added.

The first corrected local run used APIRequestContext against a fixture hostname
mapped only inside Chrome and failed. The read-only draft GET now runs through
the same browser fetch path as the existing fixture. The final target run passes
all four checks. Targeted ESLint, typecheck and diff checks also pass.

Preserved local log SHA-256:

- Reproduction (exit 1): `166b6f292f0dee7f490e7b09aa738ae6507fdf4b23d4d0315ac9a96821ff66a5`
- Intermediate fixture read failure (exit 1): `4038fe2c1697b5e4761528f67961a06166948bb6c2ccd8f0b12deda5d42b1c5c`
- Corrected target (exit 0): `ba55d5b6dcb2203020f33890622308c9ba1670c5dc6a7a1b91c2d5332df1e5e7`

Exact new-head independent review and a new natural CI run are required before
merge. Historical staff-creation HTTP 500 remains root-cause-unproven; this
separate fixture correction does not resolve or explain it.
