# Codex task — Do not execute until Architecture v1.0 is frozen

After Architecture v1.0 approval, bootstrap the implementation repository according to AGENTS.md and approved ADRs.

Initial implementation milestone should include only platform foundations:
- workspace/app/package structure
- TypeScript strict configuration
- database connection and migration framework
- test harness
- CI pipeline
- environment validation
- health endpoint
- domain types for Shop, Customer, Reservation, Renter, EquipmentRequirement, Asset, AssetIdentifier, InventoryHold, Payment

Do not implement full booking/payment UI in this first task.

Required evidence:
- clean install
- lint pass
- typecheck pass
- unit test pass
- migration validation pass
- build pass
- PR summary following AGENTS.md
