# PR #73 本番公開の手順書（Owner操作の区別つき）

作成：2026-11-20 JST、実装担当（新担当C）。更新：2026-11-21 JST、後任D（認証の実在確認とrollbackの根拠を反映）。各手順の担当と、コードが強制している前提条件を記す。**Owner** と書いた手順は本人の認証（ログイン・MFA）が必要で、実装担当は代行しない。本人認証は、既存の正規認証と対象project・DB・権限を読み取りで確認したうえで、**本当に不足するものだけ**を依頼する（下の「認証の実在確認」）。

## 0. 公開前の前提（実装担当）
1. 最終候補のコミットを確定する（SHA・treeを記録）。
2. その exact SHA の GitHub 自然CI（Foundation）が **SUCCESS** であること。前のSHAの成功は流用しない。
3. ChatGPT TD の独立最終レビューで **BLOCKER / HIGH / MEDIUM が0件**であること。
4. main との競合がないこと。

### 認証の実在確認（2026-11-21 01:55 JST、後任Dがこの端末で読み取りのみ実施）
| 対象 | 確認結果 | 本人の操作 |
|---|---|---|
| Vercel CLI | `~/.npm/_npx/.../vercel`（59.23.2）があり、`vercel whoami` が成功（既存の認証が有効） | **不要**。stage/promoteは実装担当が既存の認証で行う。期限切れなどで再認証が必要になった場合だけ依頼する |
| Neon（DB所有者） | Owner本人の許可で `neonctl` 9.9.0 の認証が完了（2026-11-21）。固定パスへ実体のシンボリックリンクを置き、同じ呼出形式で本番project/branchのmetadata読み取りに成功 | **不要**（完了）。期限切れ時のみ依頼 |
| 本番backup | `production-backup` workflowが `533902cc` で毎時SUCCESS（直近5回） | 復元試験の復号鍵の扱いは既存手順どおり（§2） |

## 1. merge（実装担当、既存のOwner包括承認の条件内）
- 条件0がすべて揃ってから、PR #73 を通常の手順で merge する。branch保護は迂回しない。
- merge後の `origin/main` のSHAを記録する。以降のDB変更スクリプトは、作業フォルダが **`origin/main` と完全に一致し、未commitの変更がない**場合だけ動く（`assertAcceptedMainRelease`）。

## 2. 本番backupと復元試験（**Owner** ＋実装担当）
- DB変更スクリプト（migrate・grantsの両方）は、**適用対象そのもの＝0001〜0058の本番DBを、24時間以内に復元した合格記録**（`.local/evidence/production-backup/restore-pass-pre-0059.json`）を要求する（`requirePre0059RestorePass`、PR73-RESTORE-01で是正）。古い記録、手で編集した記録、53本用（`restore-pass.json`）や55本用（`restore-pass-pre-0056.json`）の記録は拒否される。
- 手順：
  1. **Owner**：最新の暗号化backupを取得し、既存の手順で復元試験を**58本の登録（`expectedMigrations: 58`）として**実施する。生成物は `object-key.txt`、暗号化本体、`restore-drill-result-pre-0059.json`（受付台帳 `provisional_capacity_receipts` の指紋を含むこと）。
  2. 実装担当：`npm run production:restore-evidence-finalize-pre-0059` で `restore-pass-pre-0059.json` を作る。
- 検証済み（合成）：58本の状態から作った実際の復元結果を、新しい検証だけが受け入れ、53本用と55本用の検証は拒否する（`test:production-restore-drill`）。正しい記録があるとmigrate・grantsの両方がowner接続の手前まで進み、記録が無い・53本・55本・改変後はowner接続に届かない（`tests/unit/production-restore-evidence-pre0059.test.ts`）。

## 3. DB変更 0059〜0061 と権限（実装担当。Neonの本人認証は2026-11-21に完了済み）
- Neon CLI：Ownerが公式 `neonctl` 9.9.0 で認証済み。適用スクリプトが参照する固定パス `~/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon` には、TD #7054081173 の判断(a)に従い、実体（`~/.npm/_npx/83c76687887d2a83/...`、package `neonctl` 9.9.0、`registry.npmjs.org` の tgz と package-lock の sha512 が一致、`--version` 9.9.0）へのシンボリックリンクを1本だけ置いた（作成前に固定パスが空であることを確認）。
- 照合：固定パス経由で `neonCliPort` と同じ `api <path>` 形式により、project `curly-union-23141081`（zao-rental-production、PostgreSQL 18）と branch `br-long-king-azkou4fy`（既定、ready）のmetadataを読み取れた。接続文字列の取得・DB操作はしていない。DB所有者・host・verify-full TLSの確認は、`openOwnerSession` が正しい前提（accepted main・復元証拠）で行う別段階。
- 認証の期限切れなどで再ログインが必要になった場合だけ、**Owner** に依頼する。
- 実装担当（main と完全一致した作業フォルダで実行）：
  1. `npm run production:install-staff-delta-migration`
     - 前提：registry が 0001〜0058 で、checksum が正規であること。
     - 0059→0061 を1つのtransactionで適用し、2回目の実行は拒否される。
     - commit後の読み戻しで、registry・checksum・所有者・必須trigger 4本・承認済み規約bundleを確認する。
  2. `npm run production:install-staff-delta-grants`
     - operationsロールに、承認済みの最小権限だけを付与する。
     - あるべき権限と、あってはならない権限（insert-only の同意表への UPDATE / DELETE、PUBLIC EXECUTE など）の両方を読み戻して確認する。
- 失敗時：「commit後の読み戻しが必要」と表示された場合は、**再実行しない**。現状態の読み戻しから再開する。

## 4. 配信（実装担当。Vercelはこの端末で認証済み。再認証が必要な場合だけ **Owner**）
- 既存の公開手順（`docs/execution/release-code-closure/release-operations-v1/`、`PUBLICATION_GATES.md`）に従う。
  1. 同じartifactを保護付きでstageし、低並行の2小窓で確認する。
  2. 正規にpromoteする。
- 公開許可（indexing・公開origin）は、`PRODUCTION_PUBLICATION_APPROVAL` と配信リリースの `PRODUCTION_RELEASE_ID` が一致した場合だけ有効になる。
- 古いdeploymentが READY でも、本PRの公開証拠とはしない。

## 5. 公開後の確認（実装担当、実データは既存の承認範囲内のみ）
- 正式ドメイン `https://salomon-rental.yuge-zao.com` で以下を確認する。
  - 公開ページ（日英）、2店舗、予約〜規約同意〜決済画面。
  - スタッフ/管理画面：各役割の主要画面、スタッフQA、アカウント作成、本人のパスワード変更。
- 実決済・返金・実メールは、既存のOwner決定（#6090166024 等）で拘束された上限と宛先だけで行う。実顧客を試験台にしない。
- 結果を Issue #47 / PR #73 に記録する。デプロイID・URL・release SHA・確認結果、未実施（NOT_RUN）の項目を含める。

## 6. 戻し方（rollback）
- 配信：直前の正常なdeploymentへ戻す（Vercel）。
- DB：0059〜0061 は新しい表・関数の追加で、既存の行は書き換えない。ただし既存の `rental_bookings` に次の3つのtriggerを付けるため、「配信を戻すだけで必ず旧動作に戻る」とは言い切れない（定義から確認、2026-11-21 後任D）。
  - `staff_event_capture`（0060、INSERT／state更新）：例外をすべて内部で受け止める（`EXCEPTION WHEN OTHERS` → 退避表 → WARNING）。旧版の書込みを止めない。
  - `booking_record_terms_acceptance`（0059、INSERT）：`contact.rentalTerms` がある場合だけ動く。旧版は送らないので何もしない。
  - `customer_capture_booking`（0061、INSERT）：予約1件ごとにプロフィールとリンクを作り、例外処理を持たない。**旧版アプリの予約作成とこのtriggerを組み合わせた試験は無い（NOT_RUN）**。
  - 現在の本番は `/api/health` が `bookingAvailable:false`（2026-11-21確認）で、旧版経由の予約作成は発生していない。rollbackで旧版に戻す場合も、予約受付を閉じたまま戻すこと。予約受付を開いた状態で旧版へ戻す必要が出たら、先に旧版とこのtriggerの組み合わせを合成PGで確認する。
  - 追加された行（同意記録・通知イベント・プロフィール）は残す。データの破棄は行わない。

## 現在の位置（2026-11-21 後任D）
- 手順0：未完了。最終候補の自然CIと、ChatGPT TDの独立最終レビューが未了。
- 手順2の前提（58本用の復元証拠）と手順3の前提（Neonの認証・CLIの配置）は整った。復元試験の実施（暗号化backupの復号鍵を扱う工程）は手順どおりOwnerが行う。
- 手順1〜5：未実施。本番への変更は行っていない。
