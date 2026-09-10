# Claude task — Architecture v0.4 Red Team

You are reviewing a ski/snowboard rental platform intended for real winter resort operations with approximately 500 equipment sets.

Read all files under `/docs`, especially `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `ARCHITECTURE.md`, and ADRs.

Do NOT implement code. Try to break the architecture.

Focus on:
- inventory oversell
- date-interval inventory correctness
- hold expiry races
- Square payment and inventory divergence
- webhook duplicate/out-of-order events
- physical asset double assignment
- exchange/partial return edge cases
- maintenance state conflicts
- multi-renter group operations
- QR security/privacy
- staff authorization
- auditability
- peak-morning operational UX
- schema decisions that will be expensive to reverse

Output:
1. BLOCKER findings
2. HIGH findings
3. MEDIUM findings
4. LOW findings
5. Suggested ADR changes
6. Missing acceptance tests
7. Go / Revise recommendation for Architecture v1.0 freeze

For every BLOCKER/HIGH finding, include a concrete failure scenario and a test that would reproduce it.

Review the new operational-policy seed and OPERATIONAL_ACCEPTANCE.md, particularly AM/PM same-date competition, a missed17:00 transfer before a next-day booking, midnight/date-block and unexpected return-store handling, candidate-hold replacement races, exact-model/selected-length promises, and concurrent staff refunds with an unknown provider result. Configuration-only unit tests are insufficient proof. Do not assume previous assistant messages establish a production integration.
