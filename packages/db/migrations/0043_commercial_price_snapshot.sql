-- Additive commercial quote storage. Issuance is guarded by the registered Production
-- identity and pinned price authority in application code; JSON is not a capability.
ALTER TABLE price_quotes DROP CONSTRAINT price_quotes_snapshot_check;
ALTER TABLE price_quotes ADD CONSTRAINT price_quotes_snapshot_check CHECK ((
 snapshot->>'currency'='JPY' AND (
  snapshot->>'chargeReady'='false' OR (
   snapshot->>'chargeReady'='true' AND
   snapshot->'commercialApproval'->>'approvalVersion'='ZAO_COMMERCIAL_PRICE_V1' AND
   snapshot->'commercialApproval'->>'priceBookKey'='ZAO_2026_27_V1' AND
   snapshot->'commercialApproval'->>'priceBookId'=book_id::text AND
   snapshot->'commercialApproval'->>'revision'='2' AND
   snapshot->'commercialApproval'->>'sourceSha256'='ffd9fb8b8022952a397dd15693fd23b28e2f063b84f83c6a053e208863c948f8' AND
   snapshot->'commercialApproval'->>'tablesSha256'='12a7a493f33dc4ea46a12c7f0dc2f770938b81598721d78672985469fccd64d5' AND
   snapshot->'commercialApproval'->>'wearRevision'='ZAO-WEAR-CATALOG-UX-20260913-V1_2'
  )
 )
) IS TRUE);
-- Existing quotes_immutable and pricing_history guards remain unchanged.
