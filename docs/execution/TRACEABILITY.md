# Acceptance traceability — current implementation only

| Requirement | Executable evidence | Limit |
|---|---|---|
| v0.4 preserved / 27 tests | check:reference; test:reference | configuration/document consistency only |
| reproducible install | setup with npm ci + lock; fresh worktree verification | toolchain/platform requirements in ADR 0007 |
| TS/Next foundation | lint, typecheck, build | one private shell, no business flow |
| authorization boundary | foundation unit tests + desktop/mobile forged-role API E2E | OIDC/session provider not implemented |
| worktree isolation | stable namespace/DB/user/ports, occupied-port rejection; independent worktree PG run | collisions fail, not automatically reassigned |
| real PostgreSQL | integration: migration race/replay, seed, duplicate event, constraints, rollback, checksum, password | local disposable clusters, not production migration rehearsal |
| telemetry preparation | typed whitelisted event table + concurrent event test | no business analytics/PII/event payloads |
| signed approval / protected policy | automation unit tests | fixture trust only; protected deployment still required |
| lease / stale review / missing CI / errors / max rounds | automation unit tests + dry-run log | no live Codex→CI→Claude repair round trip |
| remote CI | PR workflow run / exact source SHA recorded in final report | not proof of human approval or branch protection |
| business operational cases (32) | docs/OPERATIONAL_ACCEPTANCE.md only | UNIMPLEMENTED / UNEXECUTED; no skip placeholder tests |

E00/E01 evidence does not complete E02's artificial-failure live round trip or E03–E18.
