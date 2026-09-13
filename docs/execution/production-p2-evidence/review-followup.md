# P2 review1 disposition and correction

Review1 target4d7ed958, snapshot62307714…, original preserved in review-01.json and PR13 comment5652674519. Verdict REVIEW_PASS with2 LOW, not findings0. Follow-up review is needed for these corrections and the previously missing source context; initial startup count1 is retained.

P2-01 reproduced: a valid secret metadata payload plus NEXT_PUBLIC_SQUARE_APIKEY was accepted before the change. The focused regression failed (exit1). There are currently no approved NEXT_PUBLIC_* names at this secret boundary, so all nonempty names now reject rather than trying to infer secret meanings. Existing private metadata without a public setting still succeeds. Full15 unit tests pass; no secret value was logged.

P2-02 is a clarity/maintenance finding, not a reproduced production defect. The restore constructor now uses backup.auth.password explicitly, matching the connection pool; no rotation or initialise is performed. Actual restored PG accepts the original synthetic credential and refuses a different password with28P01. Five real restore conditions pass. Installed version/source excerpts and MIT license are supplied. No package upgrade or real secret material.

.gitignore and workflow are supplied in full to review2, with a check of the actual CI archive and zero tracked .local files. Physical backups do not appear in that archive. Real ingress cloning/channel behavior remains an explicit owner/provider gate, not falsely closed. The earlier staff-create CI500 backend cause remains unproven and recorded.

One command after applying the fix was accidentally issued from the outer helper directory and could not find the test file; no test ran there. The correctly rooted run then passed. The failed diagnostic is kept in outer low-after.log, separate from successful low-after-correct-cwd.log.
