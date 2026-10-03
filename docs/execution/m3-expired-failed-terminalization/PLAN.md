# F2: expired unbound failed payment terminalization

Resume the existing 0053 candidate branch. An app response loss left an UNKNOWN attempt without a provider ID. The existing persisted Production reconciliation decision is ACCEPT_FAILED. No second reconciliation or provider lookup is needed.

The pure projection admits FAILED_CANCELLED only for an unbound Production attempt in SUBMITTING/UNKNOWN/PENDING/REVIEW, a PAYMENT_PENDING/PAYMENT_REVIEW booking, the exact expired ACTIVE provisional HOLD, full payment identity, and exact quote/commercial-price integrity. Unbound COMPLETED/PENDING, active HOLDs and ordinary bound FAILED behavior remain unchanged.

The repository sets the existing transaction-local actor/reason, then invokes the 0053 function once before any generic attempt update. The function independently locks/revalidates Production source and booking/attempt/HOLD, requires current actor = attempt actor = owner and zero collected money, binds FAILED/CANCELED truth, previews zero-refund/non-uncertain cancellation and calls the existing booking_cancel. Business state, claim release, cancellation outbox, projection head/event/receipt commit together. Any failure rolls everything back. Duplicate projection returns its existing receipt.

Only the Production projector gains EXECUTE on this one function. PUBLIC and other payment roles are denied; direct booking_cancel/booking_cancellation_preview privileges are not added. The function never changes actor/reason or impersonates a user. Its search_path is fixed to pg_catalog, pg_temp and all application references are schema-qualified.

`production:install-expired-failed-terminalization` requires exact clean current main, the existing pinned owner/TLS connection, registry 0001–0052 with exact historical checksums, absent 0053/function, and five restricted payment roles. It applies 0053, one grant and one registry row in a single transaction; after COMMIT it rechecks all 53 checksums and function ACLs. Credential changes and business writes are zero. COMMIT ambiguity or failed post-commit readback means READBACK_REQUIRED; never rerun the installer blindly.

The historical 0051/0052 installers retain their exact predecessor registry and apply behavior; only their source-plan count guard follows the 53-entry source tree. Disposable real-PG tests rewind 0053 → 0052 → 0051 and restore 0051 → 0052 → 0053.

After all focused checks and one full verify: one Ready PR, one Foundation CI for the tree, merge, apply 0053 once, deploy exact main once, smoke, renew the five payment-role leases by four hours, preflight, diagnostics of the existing job, project-one once, final DB/UI checks and at most one M4 cancellation delivery. Refund POST remains zero. Expected final state: CANCELLED booking, FAILED attempt/provider status, RELEASED HOLD, no refund rows, refund/max refund zero and paymentUncertain false.
