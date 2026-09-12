# Review3 follow-up (same FLOW-DEV-R1 budget)

Target0ed175ae9734848fb2eb2f7372c60a4e625ad208; verdictCHANGES_REQUIRED.
WEAR-PRICE-01 MEDIUM: SINGLE+wear accepts arbitrary item order. Pricing previously
selected items[0], so [JACKET,PANTS,POLE] used SKI_BOOTS_ONLY rather than POLES_ONLY.
Confirmed with a failing unit counterexample; then select the actual non-wear item.
Same regression passes. Explicit existing poleDAY1500 +wear5000 =6500 (no20% set
adjustment); normal protected HOLD/quote HTTP and PostgreSQL persistence pass for
both item orders. No previously saved snapshots or18/216 equipment values changed.
Review3 did not execute tests; its complete original and evidence limits are preserved.
New changes need new-head CI/review. Shared starts3/8, final reserve1, no budget reset.

Additional approved work after that review head:
-20person×5components×10days normal UI holds600equipment+400wear day claims and40
commercial quote lines; reread preserves original TTL/hash. Synthetic counts only.
-Ordinary UI reads confirmed booking version from server. No manually typed version.
Authorized return staff can retrieve exact-cycle loans and saved batches across stores;
creator equality is not substituted for recipient permission. No contact secrets returned.
-Unknown garment sizes can be quarantined even without a local pool. Explicit loan/quantity
matching records one receipt, preserves received time and never directly adds READY.
-Saved batches are discoverable from server after reload; lists disclose their finite limits.
-Integrated cards show period, Premium model+season, photo-pending state and server reference
price/20%wear adjustment. No substitute photo, unsupported stock claim or tax finalization.
-Catalog source matching preserves unknown season/SKU/quantity intention. Photo decoding
produces bounded320/640/960/1440/1920 WebP+JPEG with metadata stripped, DRAFT_ONLY.
No actual media store/CMS release, guest BFF, manufacturer import or real photo is connected.

The previous unknown-UI failure was a test assumption: added members use random immutable
keys, not person-20. It was corrected to verify40actual loan rows; product behavior was not
weakened. The first mixed-load fixture reused one source locator across models, correctly
rejected by ledger uniqueness; fixture locators now identify each synthetic model/size.

Existing equipment custody exact boundary remains blocked by the recorded automatic review.
No old guard/SECURITY DEFINER/grant bundle was applied. Main/PR3/Runner/Square untouched.
