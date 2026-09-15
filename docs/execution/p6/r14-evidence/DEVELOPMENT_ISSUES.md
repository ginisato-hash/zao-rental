# R14 implementation observations

These are retained development observations; final passing evidence does not erase them.

- Real PostgreSQL projector INSERT initially failed with SQLSTATE 42501. R13 CHECK constraints call reconciliation.valid_observation; the role lacked schema USAGE/function EXECUTE. Added those two narrow permissions, without reconciliation table writes, then the same negative/positive projection cases passed.
- An attempted negative fixture changed immutable attempt amount and correctly failed 23514. The final identity counterexample uses a separate synthetic booking/attempt with another accepted observation, preserving immutability. Price corruption is injected only at construction of a rolled-back synthetic record.
- During authoring the 0029 migration-plan entry duplicated an existing list and failed 42P07. The migration transaction rolled back; the list was corrected, all 29 versions/checksums read back, and a unique ordered-plan regression added. Applied 0001–0028 were not edited.
- The long-lived test session cached earlier TypeScript modules. A finite fresh child rechecked target selection with earlier unrelated READY jobs present, then ran due-only, cancelled-transfer and identity boundaries. Same database, no reset, no second DB.
- Interim lint parse errors and readonly NODE_ENV typing were fixed. Final suite/lint/typecheck/build/secret scan exit 0.
- Initial Vercel CLI metadata errors could not be fully classified safely. Final metadata attempt classified authentication required. No successful readback, no login or external activation followed.

No prior R4–R13 raw evidence was rewritten. These notes summarize allowlisted tool observations; they do not contain raw SQL parameters, provider bodies or credentials.
