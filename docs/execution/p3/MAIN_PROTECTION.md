# Main protection launch evidence — read-only

Owner enabled Protect main /23161641 after P2 review. The previous missing-protection statement is historical; it is not the current state. P3 made no rule edit.

| Required condition | Actual verified value |
|---|---|
| Enforcement | active |
| Branch target | ~DEFAULT_BRANCH; current default is main |
| Pull request | required |
| Required check | foundation, GitHub Actions integration15368 |
| Strict/up-to-date | true |
| Conversation resolution | true |
| Merge method | squash only |
| Force push | non_fast_forward rule |
| Bypass | actors empty; current user never |

Evidence: [actual ruleset JSON](../production-p3-evidence/ruleset-23161641.json), [pre-merge gate](../production-p3-evidence/pr13-merge-gates.json), [exact squash result](../production-p3-evidence/pr13-merge-result.json). Ready triggered CI34753917549/attempt1 on the same head/merge tree; merge waited until success. No admin/auto/setting bypass.

Approval requirements currently do not require a number of GitHub approval reviews (count0); the owner's independent static-review gate is separately evidenced in PR comments. Do not describe the Ruleset as enforcing a Claude finding count. At future activation, re-read rules/default/main/check provenance instead of relying on this dated snapshot.
