【ZAO Rental｜AVATAR PHASE 6 — LIMITED RESUME AUTHORITY V2
False-positive metadata stop correction
+ No general web search
+ Client-side Neon TLS proof】

私はOwnerとしてPhase6の限定再開を承認する。

current branch:
codex/avatar-phase6-hosted-preview

expected remote HEAD:
ae89ebec1a9dfdf07d46e8c3e48ceb9033c65953

このHEADから継続する。
最初からやり直さない。

━━━━━━━━━━━━━━━━━━
0. SECOND STOP ASSESSMENT
━━━━━━━━━━━━━━━━━━

RESUME_STOP_RECORD.mdは歴史として保持する。

ただし今回の新停止事象のTechnical Director分類は:

THIRD_PARTY_PUBLIC_SEARCH_SIGNED_URL_METADATA
NON_USER_SECRET
NO_TASK_CREDENTIAL_LINK_ESTABLISHED

である。

事実:

- 公開Web検索結果由来
- user browser tab由来ではない
- task-owned provider response由来ではない
- 値の再利用0
- 値の再表示0
- authentication replay0
- provider mutation0
- Hosted DB mutation0
- R2 mutation0
- Vercel mutation0
- Square0

したがってPhase6を継続してよい。

過去記録は削除・改変しない。

━━━━━━━━━━━━━━━━━━
1. NEW SECRET STOP RULE
━━━━━━━━━━━━━━━━━━

今後「token-like parameterが見えた」だけでは停止しない。

STOP対象は、その値が:

A.
Owner/user session由来

B.
task-owned provider session由来

C.
ZAO Rental credential / secret / connection URI由来

D.
task-owned signed URL / OAuth callback / cookie由来

E.
上記由来である合理的可能性を除外できない

場合のみ。

一方:

public search index
public documentation
third-party unrelated public asset
public CDN signed asset URL

等のtask-unrelated metadataは、

PUBLIC_EXTERNAL_METADATA

として破棄し、
値を保存・再表示せず継続。

━━━━━━━━━━━━━━━━━━
2. GENERAL WEB SEARCH BAN DURING EXECUTION
━━━━━━━━━━━━━━━━━━

Phase6 provider execution中は
general public web searchを使用禁止。

理由:
無関係なsigned URL metadataを
再びtool outputへ混入させないため。

許可:

- provider official CLI help
- provider official API
- already-known official docs URL
- official documentation検索に限定されたsource
- repo内docs

禁止:

- broad Google/web search
- generic search engine query
- unrelated search result enumeration
- search result URL query inspection

provider操作に必要な事実は
official provider sourceのみで確認する。

━━━━━━━━━━━━━━━━━━
3. BROWSER RULE REMAINS
━━━━━━━━━━━━━━━━━━

global tab inventory禁止。

cua.listTabs equivalent禁止。

task-owned tab handleのみ。

保存可:

opaque task tab id
origin

保存禁止:

full URL
query
fragment
callback
cookie
storage
session
auth parameter

browserはhuman login/MFA時のみ優先使用。

API/CLI優先。

━━━━━━━━━━━━━━━━━━
4. CURRENT BUDGETS
━━━━━━━━━━━━━━━━━━

Hosted migration:
0 / 1

new Neon resource:
0

new DB:
0

R2 bucket:
0 / 1

R2 objects:
0 / 3

dedicated Vercel project:
0 / 1

Preview deploy:
0 / 2

Claude:
initial0 / 1
correction0 / 1

Square:
0

payment:
0

Production:
0

main merge:
0

すべて維持。

Neon task-specific OAuthは
前回正式revoke済み。

必要なら新たに
task-scoped Neon OAuth acquisitionを
最大1回許可。

終了時必ずrevoke。

━━━━━━━━━━━━━━━━━━
5. RETAIN EXISTING WORK
━━━━━━━━━━━━━━━━━━

既存checkpoint/resumeでPASS済み:

- initial61 targeted tests
- local PG lock proof
- 7 hosted-migration local PG cases
- lint
- typecheck
- build
- secret scans
- migration source hash checks

を保持。

source変更が関連しない限り
全再実行不要。

Phase6 partial sourceを捨てない。

━━━━━━━━━━━━━━━━━━
6. NEON TLS — CORRECT ACCEPTANCE ORACLE
━━━━━━━━━━━━━━━━━━

重要。

Neonはclient接続をproxyで受ける。

したがって:

PostgreSQL compute側の
pg_stat_ssl.ssl

を単独の
client-to-Neon TLS acceptance oracle
として使用禁止。

server-side pg_stat_ssl=false
だけでPhase6を停止しない。

Neon公式architecture上、
client接続はNeon proxyを通るため、
backend observationと
client→proxy transportは同一とは限らない。

━━━━━━━━━━━━━━━━━━
7. TLS PROOF — CLIENT SIDE
━━━━━━━━━━━━━━━━━━

Hosted setup接続では
client-side TLSを証明する。

最低条件:

- exact expected Neon hostname
- *.neon.tech allowlist
- SNI hostname exact
- TLS socket encrypted
- certificate chain validation successful
- rejectUnauthorized=true
- peer certificate present
- hostname verification PASS
- TLS protocol >= TLS1.2
- no self-signed acceptance
- no NODE_TLS_REJECT_UNAUTHORIZED=0
- no custom insecure CA bypass

raw certificate:
保存不要。

保存可能な証拠:

encrypted=true
authorized=true
protocol
serverName classification
issuer organization classification if safe

certificate bytes/fingerprint:
不要。

━━━━━━━━━━━━━━━━━━
8. CONNECTION STRING POLICY
━━━━━━━━━━━━━━━━━━

Official Neon-acquired connection parametersを使用。

Connection string/raw passwordを
output/evidenceへ出さない。

Neon recommended:

sslmode=require
channel_binding=require

をprovider acquisitionで受け取れる場合は維持。

Node pg configでは
URL queryとssl objectの競合を調査し、
最終的に:

rejectUnauthorized=true

が実際のTLSSocketへ反映されていることを
client側で検証。

stringの設定値だけを
TLS証明にしない。

━━━━━━━━━━━━━━━━━━
9. SAFE TLS HARNESS
━━━━━━━━━━━━━━━━━━

migration runnerとは別に
secret-safe TLS preflightを作ってよい。

出力例:

{
  hostClass: "EXPECTED_NEON_ENDPOINT",
  encrypted: true,
  authorized: true,
  protocol: "TLSv1.3",
  databaseMatch: true,
  roleMatch: true
}

禁止出力:

hostname full secret query
password
connection URI
cert raw
OAuth
callback URL

TLS preflight PASS後のみ
migration preflightへ進む。

━━━━━━━━━━━━━━━━━━
10. EXPECTED NEON TARGET
━━━━━━━━━━━━━━━━━━

resource:

store_i5vh0ZEKo2ikcVo9

database:

zr_852b20c4d4b0

setup role:

neondb_owner

existing migration history:

0001–0030

expected:

0031 absent
0032 absent

new resource0
new DB0。

━━━━━━━━━━━━━━━━━━
11. HOSTED MIGRATION
━━━━━━━━━━━━━━━━━━

client TLS proof PASS後:

read-only:

current_database
current_user
foundation_migrations
0031/0032 absence
partial object state

確認。

unexpected state:
STOP。

正常なら:

0031
0032

をexactly one transactionで
max1 logical mutation run。

retry0。

migration source hashesは
current committed source exact。

R15 verifierは変更禁止。

━━━━━━━━━━━━━━━━━━
12. AFTER MIGRATION
━━━━━━━━━━━━━━━━━━

migration PASS後:

Hosted Avatar least-privilege roles

AV-3 negative proof

Guest Avatar rate limiter

PHASE5-1 hosted proof

へ継続。

中間Owner確認不要。

━━━━━━━━━━━━━━━━━━
13. R2
━━━━━━━━━━━━━━━━━━

Neon完了後のみR2へ進む。

general web search禁止。

official Cloudflare API/CLI優先。

既存compatible private bucketがあれば再利用。

無ければ:
private Phase6 bucket max1

public:
0

objects:
exact3 derivatives

source images:
0

write credential:
upload後revoke

Preview:
read-only credential

human login/MFAが実際に必要な時だけ
Ownerへ依頼。

━━━━━━━━━━━━━━━━━━
14. DEDICATED VERCEL PROJECT
━━━━━━━━━━━━━━━━━━

既存zao-rental projectは禁止。

Phase6専用:

zao-rental-avatar-preview

max1 project。

Square env:
0

payment env:
0

refund env:
0

webhook env:
0

Production secret:
0

custom domain:
0

Vercel Authentication:
ON

Preview deployment:
max2

Production deploy:
0

━━━━━━━━━━━━━━━━━━
15. HOSTED ACCEPTANCE
━━━━━━━━━━━━━━━━━━

Hosted Previewで:

390px
1440px

2 synthetic guests/members

APPEARANCE_1
APPEARANCE_2

RECOMMENDED
SHORTER
LONGER

private R2 image

Hosted Neon metadata

physical ratio

cross-guest denial

logout denial

rights revoke denial

rate-limit429

anonymous Vercel protection

を確認。

Square/payment/checkout:
実行0。

━━━━━━━━━━━━━━━━━━
16. INCIDENT REPORTING
━━━━━━━━━━━━━━━━━━

最終PASS時も
historical recordsは保持。

report:

historicalBrowserMetadataIncident:
PRESERVED

publicSearchMetadataEvent:
THIRD_PARTY_PUBLIC_SEARCH_SIGNED_URL_METADATA

userSecretCompromiseEstablished:
false

taskCredentialCompromiseEstablished:
false

knownReplay:
0

knownCredentialUse:
0

newTaskSecretExposureAfterThisResume:
0

とする。

「全tool history secretExposure=0」
のような広すぎる主張は禁止。

━━━━━━━━━━━━━━━━━━
17. CLAUDE FINAL REVIEW
━━━━━━━━━━━━━━━━━━

Hosted E2E完了後のみ。

初回1。

BLOCKER/HIGH/MEDIUM correction時のみ
correction review1。

review対象:

client-side TLS proof
Neon migration
Hosted least privilege
AV-3
rate limit
PHASE5-1
R2 private media
credential separation
Vercel isolation
cross guest
rights revoke
ARTWORK-1
incident handling
Production fail closed

PASS/LOW onlyなら終了。

━━━━━━━━━━━━━━━━━━
18. PASS
━━━━━━━━━━━━━━━━━━

条件成立時:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS

annotation:

historicalMetadataEventsPreserved=true

Production:
0

main merge:
0

real customer:
0

real booking:
0

Square:
0

Phase7へ自動継続:
0

━━━━━━━━━━━━━━━━━━
19. STOP RULE
━━━━━━━━━━━━━━━━━━

ここから停止するのは:

- task/user credentialが実際にoutputへ出た疑い
- human login/MFA
- paid upgrade
- provider terms/legal attestation
- unexpected DB state
- secret compromise合理的可能性
- Production operation必要
- new resource outside authority

のみ。

public unrelated signed URL metadataだけでは
再度停止しない。

━━━━━━━━━━━━━━━━━━
20. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後のみ:

Starting HEAD
Final HEAD
remote readback
working tree clean

TLS:
client encrypted
authorized
protocol
Neon target match

migration:
0031
0032

Hosted role
AV-3

rate limit
PHASE5-1

R2
bucket
objects3
credential cleanup

dedicated Vercel project
protection
Square env0

deployments

Hosted Guest E2E

390
1440

ratio

cross guest

logout

rights revoke

anonymous protection

ARTWORK-1

Claude verdict
severity counts

historical incidents

new task-secret exposure

Square0
payment0
Production0
main merge0

classification

next gate