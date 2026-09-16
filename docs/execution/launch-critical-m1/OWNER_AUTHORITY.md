【ZAO Rental｜LAUNCH CRITICAL M1
PR17 MAIN INTEGRATION
+ E14 MINIMUM AMENDMENT/REFUND
+ E15 OPERATIONS/ASSET ADMIN COMPLETION】

目的:

Avatar開発を終了し、
ZAO Rental全体を「実店舗でpilotできる製品」へ近づける。

今回は公開前に本当に必要な未完成機能だけを実装する。

対象:

1. PR17 exact-head main統合
2. E14の公開MVP範囲
3. E15の公開MVP範囲
4. 実在庫投入に使える安全なimport経路
5. full regression / review / CI /次PR

E16 analytics:
やらない。

Production provider接続:
まだやらない。

━━━━━━━━━━━━━━━━━━
0. CURRENT SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

PR:
#17

expected exact head:
708ef95e4e4f7e1e08d8f866f2e80f80e921daaa

expected classification:
AVATAR_TIER2_IMPLEMENTATION_COMPLETE_MAIN_MERGE_READY

expected final CI:
35132989079
PASS

Claude:
BLOCKER 0
HIGH 0
MEDIUM 0
LOW 3

migrations:
0001–0032 unchanged

開始時にGitHub remoteを再取得し:

- PR17 head exact match
- PR17 base main
- mergeable
- current required CI success
- unresolved blocking review 0
- mainがPR17 baseから予期せず進んでいないか

を確認。

head/baseが変化していたらblind merge禁止。

━━━━━━━━━━━━━━━━━━
1. PR17 FINALIZE AND MERGE
━━━━━━━━━━━━━━━━━━

PR本文が古い
「latest PR check is running」
等の記述を残している場合、
最新事実へ更新。

記録:

- final head 708ef95...
- final CI 35132989079 PASS
- 686 unit PASS
- real PostgreSQL/browser/security PASS
- Claude B/H/M 0
- Production OFF
- migrations32 unchanged

PRがDraftならReadyへ変更。

Ready化でruleset CIが再発火する場合:
そのexact headのCI PASSを待つ。

bypass禁止。

すべてPASS後:

PR17をsquash merge。

expected head SHAを必ず指定。

mainへ直接push禁止。

merge後:

origin/main
merge commit/tree
PR merged state

をreadback。

━━━━━━━━━━━━━━━━━━
2. NEW BRANCH
━━━━━━━━━━━━━━━━━━

merged mainから新branch:

codex/launch-critical-ops-m1

single writer。

Avatar branchはfreeze。

このbranchでは
Avatarの新機能を追加しない。

━━━━━━━━━━━━━━━━━━
3. IMPLEMENTATION FIRST — DO NOT CREATE CEREMONY
━━━━━━━━━━━━━━━━━━

最初に現在のmainを実際に読んで、

E14 / E15について:

EXISTING
PARTIAL
MISSING

を内部で分類。

既存service/schema/UIを再利用する。

同じ概念を別moduleとして二重実装しない。

調査だけで停止禁止。
gapを確認したらそのまま実装へ進む。

━━━━━━━━━━━━━━━━━━
4. E14 — LAUNCH MINIMUM
━━━━━━━━━━━━━━━━━━

顧客セルフサービスの高度な変更UIは不要。

初期公開ではスタッフ操作を正本とする。

必須:

A. 延長

- booking/rentalを直接書き換える前にavailability確認
- 延長期間の実Asset/quantity availabilityを保護
- 他予約を破壊しない
- 差額quoteを固定
- original booking/payment snapshot保持
- 同時延長競合は1件だけ成功
- response loss時も二重変更しない

B. 短縮・早期返却

原則:
短縮だけで自動返金しない。

contracted period/payment snapshotは履歴として保持。

actual return:
custody上は早く返却可能。

financial refund:
別操作。

C. 商品交換

staff only。

例:

ski length変更
ski/board交換
boot交換
wear size変更

必要条件:

- replacement availability
- current custody確認
- old/new Asset transition atomic
- 次予約保護
- 店舗/location条件維持
- price difference quote
- audit
- idempotency

交換失敗時:
元の貸出状態を壊さない。

D. 追加請求

既存payment abstractionを再利用。

extension / paid exchange等から
追加金額をimmutable charge requestとして作る。

browser redirectだけで成功扱い禁止。

provider transmissionは
次のProduction/Sandbox接続工程。

今回はprovider-independent state machineまで完成。

E. REFUND_OVERRIDE

指定permissionだけ。

必須:

- staff permission
- reason required
- requested amount
- original paid amount
- already refunded amount
- remaining refundable cap
- concurrency lock
- idempotency key
- audit
- PENDING / UNKNOWN state

二重refund:
絶対禁止。

通常staff:
refund不可。

自動refund:
0。

━━━━━━━━━━━━━━━━━━
5. E14 TESTS
━━━━━━━━━━━━━━━━━━

実PostgreSQLで最低:

- 延長成功
- 延長在庫不足
- 同時延長
- 延長response loss再送
- 早期返却で自動返金0
- 交換成功
- 交換在庫不足時に元状態保持
- 他店舗/移動中asset誤割当拒否
- refund権限なし拒否
- refund残額超過拒否
- 同一refund並列実行1成功
- UNKNOWN後の別key二重返金防止

通常Next UI/API/DBも通す。

━━━━━━━━━━━━━━━━━━
6. E15 — OPERATIONS / ASSET ADMIN
━━━━━━━━━━━━━━━━━━

公開前必須の管理機能を完成させる。

既存Asset/catalog/inventoryモデルを正本にする。

A. Asset管理

管理画面から:

- 登録
- 検索
- 詳細
- 更新
- 現在店舗
- 状態
- 履歴

を扱えること。

既存permission/store scopeを必ず使用。

B. ID / QR LABEL

ルール:

SKI:
1 pair = 1 Asset ID
左右両方に同じID/QR
labels = 2

SNOWBOARD:
1 Asset
labels = 1

BOOT:
左右1組 = 1 Asset
必要に応じ同一IDを両側へ印刷可能

POLES:
individual Asset化しない。
PAIR quantity pool。

WEAR:
現在のcanonical quantity/stock modelを維持。
勝手にindividual Asset化しない。

labelには:

- human readable Asset ID
- QR/barcode
- minimal item hint

のみ。

PII禁止。

ブラウザ印刷可能なlabel sheetを作る。
PDF専用library追加は必要なければ行わない。

C. Maintenance / Inspection

既存状態定義を調査して再利用。

最低概念:

AVAILABLE
INSPECTION_REQUIRED / equivalent
MAINTENANCE / equivalent
RETIRED / unavailable equivalent

同義状態を重複作成しない。

販売/割当可能か否かを
UI側ではなくserver/domain側で強制。

maintenance/unavailable Assetは:

new HOLD
replacement candidate
immediate lending

から除外。

返却時にinspectionへ遷移可能。

履歴とactorを保存。

D. 棚卸

店舗単位。

asset:
scanでpresence確認。

poles/wear quantity:
count入力。

棚卸結果とcanonical在庫との差異を表示。

重要:

棚卸scanだけで
勝手にlocation/quantityを書き換えない。

difference:
REVIEW_REQUIRED

explicit reconcile権限でのみ修正。

すべてaudit。

━━━━━━━━━━━━━━━━━━
7. REAL INVENTORY IMPORT PATH
━━━━━━━━━━━━━━━━━━

実データそのものはまだ投入しない。

既存importerがあれば拡張。
新しいparallel importerを作らない。

公開前に実データを投入できるよう:

CSV template
+
dry-run
+
commit

の2段階方式を完成。

最低項目:

source row
item category
model
size/length
tier/class
store
asset identifier
quantity where applicable
BSL if actually known
status

dry-runで:

- duplicate Asset ID
- duplicate source
- invalid category
- impossible quantity
- unknown store
- invalid size
- missing mandatory field
- existing row conflict

を表示。

未知値を推測しない。

BSL:
不明ならnull。

idempotent import。

同じfileを再投入して
Assetを複製しない。

実500セットのfileが無ければ:
synthetic fixtureで経路のみ完成。

━━━━━━━━━━━━━━━━━━
8. PRICE / ADMIN GAPS
━━━━━━━━━━━━━━━━━━

既存E08 price/version管理を確認。

公開に必要な:

draft
preview
authorized publish
old booking snapshot preservation

が既に成立していれば変更しない。

欠けている部分だけ補う。

実価格そのものの公開:
このphaseではしない。

━━━━━━━━━━━━━━━━━━
9. UI REQUIREMENT
━━━━━━━━━━━━━━━━━━

スタッフ運用画面は
デモ画面ではなく通常apps/webへ接続。

最低:

/admin/assets
/admin/inventory or canonical equivalent
/staff rental/amendment path

既存route構造へ合わせる。

PC:
1280+

tablet:
768

mobile:
390

で操作可能。

特にscan操作は
片手使用を想定して
主要button/tap targetを狭くしすぎない。

ただし見た目の全面リデザインは禁止。

━━━━━━━━━━━━━━━━━━
10. SECURITY
━━━━━━━━━━━━━━━━━━

今回business writeを増やすので
Tier2より一段強いdomain validationを行う。

server-side:

permission
store scope
booking ownership/custody
amount bounds
inventory concurrency
idempotency

を必須。

UI非表示だけで認可しない。

secret/PIIをlogしない。

Square Production:
0。

Production DB:
0。

━━━━━━━━━━━━━━━━━━
11. MIGRATION POLICY
━━━━━━━━━━━━━━━━━━

既存0001–0032:
変更禁止。

schema追加が本当に必要な場合のみ
additive migration:

0033+

を許可。

migrationを増やさず既存schemaで正しく表現できるなら
そちらを優先。

migrationが必要なら:

real PostgreSQL migration test
upgrade from current main
rollback/recovery reasoning

を追加。

━━━━━━━━━━━━━━━━━━
12. VALIDATION
━━━━━━━━━━━━━━━━━━

targeted implementation完了後:

- full unit
- real PostgreSQL
- E14 concurrency
- E15 permission/state
- normal browser UI
- inventory/HOLD regression
- transfer regression
- pricing regression
- recommendation regression
- rental/custody regression
- payment state regression
- Avatar regression
- lint
- typecheck
- build
- secret scan
- git diff --check

を実行。

過去のhistorical transient failureを
再現しない限り掘り返さない。

retry/skipでPASS化禁止。

━━━━━━━━━━━━━━━━━━
13. CLAUDE REVIEW
━━━━━━━━━━━━━━━━━━

実装完成後に1回。

review scope:

- E14 financial invariants
- refund concurrency/idempotency
- amendment inventory integrity
- asset state transitions
- maintenance exclusion
- stocktake reconciliation
- authorization/store scope
- migration if any

Claude:

tools0
browser0
provider0
edit0

BLOCKER/HIGH/MEDIUM:
修正。

LOW:
記録。

修正後の再reviewは
B/H/Mの修正を確認する場合のみ1回。

個別payload承認をOwnerへ再要求しない。

━━━━━━━━━━━━━━━━━━
14. CI / PR
━━━━━━━━━━━━━━━━━━

実装HEADをpush。

mainへDraft PR作成。

CI PASSまでscope内で修正。

main merge:
今回はしない。

final PR bodyは簡潔に:

- implemented launch-critical E14/E15 scope
- migration result
- test counts
- Claude result
- remaining launch gaps
- Production operations0

を記載。

━━━━━━━━━━━━━━━━━━
15. DO NOT IMPLEMENT
━━━━━━━━━━━━━━━━━━

今回やらない:

- analytics dashboard / E16
- ROI
- AI optimization
- Production Square credentials
- real customer payment
- Production Vercel deploy
- domain切替
- real email delivery
- real500-set import
- Search Console
- marketing
- autonomous Runner revival
- unrelated refactor

━━━━━━━━━━━━━━━━━━
16. TERMINAL
━━━━━━━━━━━━━━━━━━

以下成立で:

LAUNCH_CRITICAL_M1_COMPLETE_MAIN_MERGE_READY

条件:

- PR17 merged
- E14 launch-minimum complete
- E15 launch-minimum complete
- import pathway ready
- full regression PASS
- Claude B/H/M 0
- CI PASS
- next Draft PR ready
- Production0
- real payment0
- real inventory import0

次gate:

LAUNCH CRITICAL M2 —
REAL DATA + PRODUCTION CONNECTION + FIELD ACCEPTANCE

内容:

- real inventory import
- Production Neon
- Square Production/Webhook
- email
- private R2
- Vercel/domain
- backup/PITR
- real devices/labels
- staff rehearsal
- limited pilot

M1からM2は自動開始しない。

━━━━━━━━━━━━━━━━━━
17. OWNER INTERRUPT POLICY
━━━━━━━━━━━━━━━━━━

途中でOwnerへ戻ってよいのは:

- human login/MFA
- billing/terms
- business ruleが本当に未定義で安全に進められない
- secret exposure
- main merge
- Production/real customer operation

のみ。

普通の:

test failure
code defect
migration defect
CI failure
review finding

で止まらず自律修正する。

中間報告を乱発しない。
最後まで実装してから報告。