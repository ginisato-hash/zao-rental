export function paymentActivationRoleNames(n:string){
 if(!/^zr_[a-f0-9]{12}$/.test(n))throw new Error('DEVELOPMENT_NAMESPACE_REQUIRED');
 return {receiver:n+'_pay_receipt',dispatcher:n+'_pay_dispatch',worker:n+'_pay_truth',projector:n+'_pay_projection',diagnostic:n+'_pay_diagnostic',publicProbe:n+'_pay_public'};
}
export function paymentActivationGrants(n:string,scope:'R14_LOCAL'|'R15_TARGETED'){
 const names=paymentActivationRoleNames(n);
 return [
  `GRANT USAGE ON SCHEMA r15_activation TO ${names.worker}`,
  `GRANT EXECUTE ON FUNCTION r15_activation.reserve(text,text,uuid,uuid,text,text,text) TO ${names.worker}`,
  `REVOKE ALL ON DATABASE ${n} FROM PUBLIC`,
  'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
  `GRANT USAGE ON SCHEMA square_webhook TO ${names.receiver}`,
  `GRANT EXECUTE ON FUNCTION square_webhook.receive(text,text,text,text,text,text) TO ${names.receiver}`,
  `GRANT USAGE ON SCHEMA payment_reconciliation TO ${names.dispatcher},${names.worker},${names.diagnostic}`,
  `GRANT EXECUTE ON FUNCTION payment_reconciliation.dispatch(text,integer),payment_reconciliation.dispatch_target(text,integer,text,text) TO ${names.dispatcher}`,
  `GRANT EXECUTE ON FUNCTION payment_reconciliation.claim(text,text,integer),payment_reconciliation.claim_target(text,text,integer,text,text),payment_reconciliation.finalize(uuid,uuid,bigint,text,text,integer,jsonb),payment_reconciliation.load_context(text,text,text),payment_reconciliation.load_contexts(text,uuid[]) TO ${names.worker}`,
  `GRANT EXECUTE ON FUNCTION payment_reconciliation.diagnostics(text,integer) TO ${names.diagnostic}`,
  `GRANT USAGE ON SCHEMA public,payment_projection,payment_reconciliation TO ${names.projector}`,
  `GRANT SELECT(id,owner_id,hold_id,quote_id,conditions,price_snapshot,price_sha256,mode,state,confirmed_at,version) ON rental_bookings TO ${names.projector}`,
  `GRANT SELECT ON rental_payment_attempts,inventory_holds,inventory_claims,wear_claims,wear_pools,ledger_assets,ledger_poles,ledger_variants,ledger_models,transfer_pieces,transfer_batches TO ${names.projector}`,
  `GRANT SELECT(id,actor,hold_id,conditions,snapshot,snapshot_sha256,coupon_id) ON price_quotes TO ${names.projector}`,
  `GRANT UPDATE(state,confirmed_at,version) ON rental_bookings TO ${names.projector}`,
  `GRANT UPDATE(state,provider_id,provider_state,provider_updated_at,completed_at,updated_at) ON rental_payment_attempts TO ${names.projector}`,
  `GRANT UPDATE(payment_state,confirmed_at,version) ON inventory_holds TO ${names.projector}`,
  `GRANT SELECT,INSERT ON payment_projection.heads,payment_projection.events,payment_projection.job_receipts TO ${names.projector}`,
  `GRANT UPDATE(revision,last_observation) ON payment_projection.heads TO ${names.projector}`,
  `GRANT USAGE ON SEQUENCE payment_projection.events_id_seq TO ${names.projector}`,
  `GRANT EXECUTE ON FUNCTION inventory_clock(),payment_projection.lock_source(uuid),payment_reconciliation.valid_observation(jsonb) TO ${names.projector}`,
 ].map(sql=>scope==='R15_TARGETED'?sql.replace('payment_reconciliation.dispatch(text,integer),','').replace('payment_reconciliation.claim(text,text,integer),',''):sql);
}
