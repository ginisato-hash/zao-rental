-- Additional restriction on an unconnected table; no roles, grants or operational receipt path.
-- Actual physical receipt may precede QR scanning. It is distinct from scan and confirmation time.
ALTER TABLE rental_receipts ADD CONSTRAINT rental_receipt_scan_before_confirmation CHECK(scanned_at<=confirmed_at);
