// Canonical ordered migration plan. Pure data so it can be imported anywhere, including
// the web bundle, without pulling in filesystem resolution.
export const migrationPlan = [
  {id:'0001', file:'0001_foundation.sql'}, {id:'0002', file:'0002_ledger.sql'}, {id:'0003',file:'0003_staff_auth.sql'}, {id:'0004',file:'0004_period_hold.sql'}, {id:'0005',file:'0005_store_transfer.sql'}, {id:'0006',file:'0006_pricing_quote.sql'}, {id:'0007',file:'0007_recommendation.sql'}, {id:'0008',file:'0008_staff_settings_boundary.sql'}, {id:'0009',file:'0009_development_booking.sql'},{id:'0010',file:'0010_rental_custody.sql'},{id:'0011',file:'0011_receipt_timeline.sql'},{id:'0012',file:'0012_integrated_wear_catalog.sql'},{id:'0013',file:'0013_wear_quantity.sql'},{id:'0014',file:'0014_wear_return_batch.sql'},{id:'0015',file:'0015_custody_boundary.sql'},{id:'0016',file:'0016_delayed_pickup.sql'},{id:'0017',file:'0017_no_pickup_completion.sql'},{id:'0018',file:'0018_guest_actor.sql'},{id:'0019',file:'0019_content_workspace.sql'},{id:'0020',file:'0020_content_media.sql'},{id:'0021',file:'0021_guest_security.sql'},{id:'0022',file:'0022_booking_access.sql'},{id:'0023',file:'0023_sandbox_activation.sql'},{id:'0024',file:'0024_booking_recovery.sql'},{id:'0025',file:'0025_square_webhook_inbox.sql'},{id:'0026',file:'0026_payment_reconciliation.sql'},{id:'0027',file:'0027_payment_projection.sql'},{id:'0028',file:'0028_development_projection_source.sql'},
  {id:'0029',file:'0029_development_payment_scope.sql'},
  {id:'0030',file:'0030_r15_operation_guard.sql'},
  {id:'0031',file:'0031_avatar_visuals.sql'},
  {id:'0032',file:'0032_avatar_delivery_boundary.sql'},
  {id:'0033',file:'0033_launch_operations.sql'},
  {id:'0034',file:'0034_booking_notification.sql'},
  {id:'0035',file:'0035_operations_console.sql'},
  {id:'0036',file:'0036_field_acceptance.sql'},
  {id:'0037',file:'0037_field_acceptance_scope.sql'},
  {id:'0038',file:'0038_real_inventory_provenance.sql'},
  {id:'0039',file:'0039_real_data_quantity.sql'},
  {id:'0040',file:'0040_production_payment_admission.sql'},
  {id:'0041',file:'0041_provisional_booking_capacity.sql'},
  {id:'0042',file:'0042_inventory_buffer_override.sql'},
  {id:'0043',file:'0043_commercial_price_snapshot.sql'},
  {id:'0044',file:'0044_pole_exemption_witness.sql'},
] as const;
