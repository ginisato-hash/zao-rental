# RECOMMENDATION_ENGINE.md — Recommendation and Customer Choice v0.4

## Preserved owner rules
Rules are versioned. Initial ski and snowboard target: height_cm - 20.
Absolute allowed search window: [target - 15, target + 15] cm. This is an operational candidate-search rule, not automatic safety approval.
Ski inputs: height, weight, foot size, skier level/type and age. Snowboard inputs: height and foot size, plus adult/kids category; do not add mandatory weight, level or exact age to the snowboard booking form.
Adult is 13+ on rental start. Never cross adult/kids inventory, even if sizes match.

## Customer choice requested in v0.4
Show an initially recommended available item, then buttons:
- おすすめで進む / RECOMMENDED
- 短めを見る / SHORTER
- 長めを見る / LONGER

Each card must show the actual candidate length, applicable class, availability and price. A direction click shows/selects the corresponding candidate for explicit confirmation. Only the final chosen requirement is held, not all three alternatives.

## Candidate construction (proposed deterministic implementation)
1. Filter by sport, age category, chosen tier, compatibility rules, maintenance/retirement status and the original body's absolute +/-15 cm window.
2. Check the complete requested duration and pickup-store feasibility, including day-blocked capacity and committed transfers. Do not build recommendations from global current stock count alone.
3. Recommended: closest feasible length to the original target. A configurable equal-distance tie rule initially prefers the shorter candidate; this is not a claim of safety superiority. Tie within the same length by stable catalog key.
4. Shorter: nearest eligible length strictly below that initial recommended available length. Longer: nearest eligible length strictly above it. Options remain anchored to the initial recommendation, not recursively shifted from the last button click.
5. If no eligible candidate exists in a direction, disable that choice and explain. If no recommendation exists, show no-availability or staff-contact flow; never invent a length or silently broaden the limits/tier/category.

Example only: height 170 -> original target 150. If eligible available lengths are 145,150,155, show recommended 150 / shorter 145 / longer 155. Allowed window stays 135–165 for this renter regardless of repeated button use.

## What the customer is promised
Persist original target, rule-set version, initial recommendation, chosen direction, selected length, selected tier, shown catalog/model reference, model-guarantee policy and quote version. An exact asset ID need not be promised.
The model display must match the reservation constraint: if a particular model is guaranteed, include model in the requirement. If allocation may use an equivalent model, disclose that before acceptance rather than presenting a named model as guaranteed. This is an implementation guardrail, not approval for an undisclosed substitution.
The selected length and tier are binding reservation constraints. Never silently replace them after payment. A later change requires customer agreement/staff workflow and a valid revised allocation.

## Atomic selection / hold
Browsing recommendations does not hard-hold every candidate. Group checkout atomically holds the selected bundle requirements for all renters, including boots and pole quantities.
If a customer changes a length while a valid hold exists, acquire a feasible replacement and release the previous claim in the same transaction. On failure preserve the old valid hold/quote, report the conflict and ask for another choice. Do not release the old hold first; do not hold both indefinitely. Changing selection does not extend the original hold TTL unless a separately approved policy allows it.
After expiry, create/revalidate a new quote and capacity claim. If payment is pending/unknown, block mutation of the accepted payment attempt and reconcile before starting another. Price or product changes require an updated accepted quote.

## Boots
Initial candidate size is input foot_size_cm + 1.0. Preserve the requested larger-candidate notice with an explicit staff try-on/final-fit qualification, not a universal guarantee that larger is safe/correct. Allowed neighboring-size fallback is still unresolved; do not silently enlarge further.
Ski boots must carry actual BSL mm for the assigned asset/model-size. Snowboard boots do not require an alpine BSL field.

## Binding / fit boundary
Sizing buttons do not bypass fitting, boot/binding compatibility, actual BSL confirmation or technician workflow. Store input/selected/recommended values separately. Do not implement an independent DIN formula without the shop-approved reference/version and verification procedure.
The length recommendations remain proposals until staff final fit. Snowboard weight/model considerations, where needed, are handled by shop final-fit procedure rather than silently adding required customer fields.
