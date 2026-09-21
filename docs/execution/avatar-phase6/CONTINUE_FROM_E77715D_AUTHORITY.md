【ZAO Rental｜Phase6 CONTINUE FROM e77715d】

current canonical remote HEAD:

e77715d10341a7e12b4a47d584030b8da869ea9d

Owner approval for the existing R2 write-credential handoff is ALREADY GRANTED
and persisted in:

docs/execution/avatar-phase6/R2_HANDOFF_OWNER_APPROVAL.md

DO NOT request Owner approval again.

Current blocker is only:
AUTOMATIC_APPROVAL_REVIEW_CAPACITY_ERROR

This is NOT:
- a secret incident
- a Cloudflare login failure
- an absent Owner authority
- a failed credential creation

Resume exactly from the pending handoff when the approval service permits it.

━━━━━━━━━━━━━━━━━━
1. DO NOT REPEAT COMPLETED OPERATIONS
━━━━━━━━━━━━━━━━━━

Do NOT rerun:

- Neon OAuth acquisition unless a later operation strictly requires a fresh task-owned session
- hosted migration
- 0031
- 0032
- role creation
- AV-3 proof
- hosted artwork metadata import
- R2 bucket creation
- write credential creation

Existing write credential:

name:
zao-avatar-phase6-upload-v2

scope:
exact bucket zao-rental-avatar-p6

permission:
OBJECT_READ_WRITE

TTL:
24h

status:
UI_COMPLETION_REACHED
HANDOFF_PENDING

Treat this exact credential as canonical.

━━━━━━━━━━━━━━━━━━
2. RESUME WRITE-CREDENTIAL HANDOFF
━━━━━━━━━━━━━━━━━━

When automatic approval becomes available:

read ONLY the already-created Phase6 credential result page
in the task-owned ordinary Chrome context.

Do not enumerate tabs.
Do not read account cookies/session/localStorage.
Do not print credential values.

Transfer only:

- accessKeyId
- secretAccessKey
- required account/bucket identity
- expiry

through the already-prepared owned 127.0.0.1 handoff form
into the exclusive 0600 local file outside Git.

Credential values:
- stdout 0
- chat 0
- repo 0
- evidence 0
- screenshots 0

No additional Owner confirmation.

━━━━━━━━━━━━━━━━━━
3. EXACT3 R2 UPLOAD
━━━━━━━━━━━━━━━━━━

After successful handoff:

run the already-prepared bounded upload path once.

Upload exactly:

appearance-1.webp
appearance-2.webp
generic-ski.webp

keys:

private/derivative/sha256/<approved digest>

logical upload run:
max1

objects:
exact3

retry:
0 unless provider itself proves request was never dispatched.

For each object:

PUT
private readback
byte length match
SHA256 match

must PASS.

If dispatch outcome is unknown:
do not blindly retry.
Preserve UNKNOWN_DO_NOT_RETRY and reconcile by safe read.

━━━━━━━━━━━━━━━━━━
4. REVOKE WRITE KEY IMMEDIATELY AFTER VERIFIED UPLOAD
━━━━━━━━━━━━━━━━━━

After all 3 objects PASS:

revoke/delete:

zao-avatar-phase6-upload-v2

through the normal authenticated Cloudflare UI/API path.

Then delete:

local 0600 write credential file

Verify only:

credential no longer active

Do not persist credential value.

━━━━━━━━━━━━━━━━━━
5. CREATE RUNTIME READ-ONLY CREDENTIAL
━━━━━━━━━━━━━━━━━━

Create exactly one new credential:

suggested name:
zao-avatar-phase6-read-v1

scope:
ONLY zao-rental-avatar-p6

permission:
OBJECT_READ_ONLY

No write.
No delete.
No bucket admin.
No account admin.
No public access.

This operation is already within Phase6 authority.
DO NOT ask Owner for another approval.

Use the same secret-safe localhost handoff mechanism.

Persist only in the Preview secret handoff path required for Vercel.
Never Git.

━━━━━━━━━━━━━━━━━━
6. VERIFY R2 RUNTIME BOUNDARY
━━━━━━━━━━━━━━━━━━

With read-only credential:

exact3 approved derivatives:
READ PASS

PutObject:
DENY

DeleteObject:
DENY

other bucket access:
DENY if safely testable without broad enumeration

r2.dev:
disabled

public/custom domain:
0

bucket public listing:
0

━━━━━━━━━━━━━━━━━━
7. DEDICATED VERCEL PROJECT
━━━━━━━━━━━━━━━━━━

Create the already-authorized dedicated project:

zao-rental-avatar-preview

max1.

Do NOT use existing zao-rental project.

Configure Preview-only minimal env.

Must contain:

Avatar/Guest/Neon runtime config
R2 read-only credential
Preview security config

Must NOT contain:

SQUARE_*
PAYMENT_*
REFUND_*
WEBHOOK_*

Verify names only.
Never print env values.

Square env count:
0

Deployment Protection:
Vercel Authentication ON

Production deploy:
0

custom domain:
0

━━━━━━━━━━━━━━━━━━
8. PROTECTED PREVIEW DEPLOY
━━━━━━━━━━━━━━━━━━

Deploy:

codex/avatar-phase6-hosted-preview

Preview only.

max remaining deployments:
2

Anonymous:
blocked by Vercel protection.

No public bypass/share link.

━━━━━━━━━━━━━━━━━━
9. HOSTED ACCEPTANCE
━━━━━━━━━━━━━━━━━━

Run hosted protected GuestBooking E2E:

390px
1440px

APPEARANCE_1
APPEARANCE_2

RECOMMENDED
SHORTER
LONGER

2 synthetic members

actual Neon metadata
actual private R2 bytes

physical ratio tolerance:
existing Phase4/5 tolerance

Verify:

cross-guest deny
anonymous app deny
logout old media deny
stale revision deny
wrong member deny
wrong visual deny
wrong digest deny
rights revoke deny
rate limit 429
provider failure degrades Avatar only

Extra:
recommendation calls 0 from visual interaction
HOLD 0
quote 0
payment 0
business writes 0

━━━━━━━━━━━━━━━━━━
10. CLAUDE FINAL REVIEW
━━━━━━━━━━━━━━━━━━

Only after hosted acceptance.

initial max1.

Review:

Neon hosted state
AV-3
PHASE5-1
R2 private/read-only boundary
write-key cleanup
Vercel isolation
Square env0
protected Preview
cross-guest
logout
rights revoke
ARTWORK-1
historical metadata incidents
Production fail-closed

PASS / LOW only:
no second review.

BLOCKER/HIGH/MEDIUM:
local correction then correction review max1.

━━━━━━━━━━━━━━━━━━
11. CAPACITY ERROR HANDLING
━━━━━━━━━━━━━━━━━━

If automatic approval review again returns:

Selected model is at capacity

this is a tooling availability error.

Do NOT:
- create another write key
- upload by alternate unsafe route
- broaden permission
- ask Owner for the same approval
- rerun migrations
- recreate bucket

Preserve exact state and retry only the previously blocked approval-gated operation
when service capacity returns.

No new safety-stop classification is needed solely for model capacity.

━━━━━━━━━━━━━━━━━━
12. CURRENT BUDGETS
━━━━━━━━━━━━━━━━━━

migration:
1/1 USED — DO NOT TOUCH

R2 bucket:
1/1 USED — DO NOT CREATE ANOTHER

R2 objects:
0/3

write credential:
1 created / handoff pending

read credential:
0 created

dedicated Vercel project:
0/1

Preview:
0/2

Claude:
0/1 initial
0/1 correction

Square:
0

payment:
0

Production:
0

main merge:
0

━━━━━━━━━━━━━━━━━━
13. SUCCESS CLASSIFICATION
━━━━━━━━━━━━━━━━━━

If hosted E2E + final Claude satisfy:

BLOCKER0
HIGH0
MEDIUM0

then:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS

Historical metadata incidents remain preserved.

Do NOT continue to Phase7 automatically.