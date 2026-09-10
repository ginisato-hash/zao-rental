# PERFORMANCE.md — Non-Functional Targets v0.1

## Target scale
Design tests above expected real scale so performance regressions are visible before winter operation.

Synthetic baseline dataset:
- 1,500+ assets (to exceed initial ski/snowboard count and allow related gear)
- 10,000+ reservations history
- 100 concurrent customer sessions for stress scenarios
- 20+ simultaneous staff clients

## Critical scenarios
- ten customers compete for the final three units in the same inventory bucket
- duplicate payment webhook delivery
- out-of-order webhook events
- duplicate reservation QR scans
- duplicate asset scans
- two staff attempt to assign same asset
- exchange while original asset still OUT
- return flags damage and routes to MAINTENANCE

## SLO-style targets for V1
- availability response p95: < 500 ms in staging load test
- asset lookup API p95: < 300 ms in staging load test
- staff scan → useful screen: < 1 s target under normal store network/device conditions
- zero oversell in concurrency suite
- zero duplicate confirmed bookings from webhook replay suite
