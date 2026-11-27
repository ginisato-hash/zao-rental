# 0065 団体の貸出・返却接続：本番の権限実測と、外部問い合わせなしの前進方針（Issue #47 / TD #7213588653 §2・#7214138953 §A）

> **Owner指示（2026-11-27）：Neonサポートを含む外部への連絡・問い合わせ・依頼・代理連絡・送付要請は一切禁止。** 本書に実行可能な外部依頼の手順は無い。§4 は「owner が 0065 を適用できるための技術的な成立条件」を記録した**歴史的な技術記録**であり、誰かに頼む手順ではない。訂正の正本は Issue #47 の #7214095682。

状態：**本番は 0064 のみ（`custodyLink: NOT_APPLIED`）。0065 は未適用（保留）。** 団体の貸出・返却は `GROUP_CUSTODY_NOT_ACTIVATED`（409）、新規の団体入口は閉鎖を維持する。団体数0、通常の予約・貸出・返却は影響を受けない。

## 1. 本番の実測（READ ONLY・2026-11-27、秘密値なし）

neondb_owner の READ ONLY トランザクションで読み取った。書き込み0、ROLLBACK 済み。

| 対象 | 実測 |
|---|---|
| 接続主体 | `neondb_owner`（SUPERUSER ではない、CREATEROLE あり）。PostgreSQL 18.7 |
| `neondb_custody_executor` | NOLOGIN・NOINHERIT・非SUPERUSER。**メンバー（ADMIN含む）が0人** |
| owner のメンバーシップ | `neon_superuser`（grantor `cloud_admin`、ADMINなし）、`neondb_role_admin`（ADMINあり／SETあり） |
| `neondb_role_admin` | 各アプリロールの ADMIN。**`custody_executor` の ADMIN は無い** |
| executor 所有の関数 | `rental_validate_loan` / `rental_apply_receipt` / `rental_stage_guard`（SECURITY DEFINER・search_path 固定） |
| owner 所有の関数・表 | `rental_loan_items` / `inventory_holds` / `ledger_assets` / `group_*` の表、`group_custody_hold_update`、`group_order_guard`、`group_consistency` |

## 2. なぜ owner の通常経路で 0065 が適用できないか（42501・保持する事実）

0065 は、executor 所有の `rental_apply_receipt` と `rental_stage_guard` の本体を置換する（`CREATE OR REPLACE`）。owner は関数の所有者でも所有ロールの権限継承者でもないため 42501 になる。executor へ SET/INHERIT できる非SUPERUSERは存在しない。**この拒否は安全境界として尊重し、同じ本番 SQL を反復しない。** 権限不足のままの GRANT/ALTER、既存ガードの削除・弱化・無効化、擬似予約や偽決済は行わない。

## 3. 「executor 所有関数を変更しない互換設計」の評価（不採用）

1. 返却の効果（資産の店舗移動、PAIR の数量移動）は、`ledger_assets` / `ledger_poles` のガードが **`current_user = <db>_custody_executor` を直書き**で検査して許可している（0015、0033）。別の executor や owner 所有の関数で同じ更新をするには、これら在庫の中核ガード本体の書き換えが必要で、弱化と区別がつかない。
2. 既存の `rental_apply_receipt` は予約（`rental_bookings`）を `STRICT` で引くため、団体の貸出（予約なし）をそのまま通せない。擬似の予約行は、団体と予約を分離する仕様に反する。
3. 新しい executor へ関数の所有を移す案も、1 と同じ理由で採らない。

## 4. 技術記録：owner が 0065 を適用できる成立条件（非実行・依頼ではない）

次が**同時に**成立するときだけ、owner は 0065 を 1 トランザクションで適用できる。これは条件の記録であり、成立させるための外部依頼は禁止されている。

- `neondb_custody_executor` に、member=`neondb_owner`・`inherit_option=t`・`set_option=t`・`admin_option=f` の行が**1行だけ**ある（これは最初のブートストラップが executor 作成時に使った橋渡しと同じ形、`scripts/production-bootstrap.ts`）。
- 適用中だけ executor が `public` スキーマの CREATE を持つ（`ALTER FUNCTION … OWNER TO executor` の要件）。インストーラは同一トランザクション内で付与→適用→撤去し、スキーマ ACL の一致を確認する。DB 所有者だけで行える。

隔離PG の本番トポロジ再現（`tests/operations/production-0057-owner-apply.ts`）で、上の条件が成立するとき 0065 が owner 1 トランザクションで適用でき、通常の貸出検証関数が不変であることを実証済み。**本番の現状ではこの条件は成立しておらず、成立させる手段は本書の範囲に無い。**

## 5. 条件が成立していない現状での前進方針（外部問い合わせなし）

既存の本番 DB を改変せずに実施できる範囲で、次を技術検証の対象にする。

1. **新規の隔離 PG への正規ブートストラップ＋0065 を含む全移行＋検証済みバックアップからの復元**の代替構成を、合成データで実証する。初期ロール作成時に適法な一時的管理権限を保持する設計（役割管理者が executor に対する ADMIN を持つ形）、将来の前進 migration の保守性、runtime への権限継承なし、migration 専用の限定権限・失効・監査を明示する。
2. 検証項目：0064→0065 と 0065 込みの初期構築の同一性、復元順序、registry/checksum、schema/ACL/roles/constraints/triggers、既存の予約・在庫・売止・決済/返金・スタッフ・通知・会計の同一性、セッション・外部 worker・秘密管理、通常予約と団体の競合。
3. 現 DB から新規 DB への移行が必要な場合は、バックアップだけでなく、書込み停止窓、最終照合、復旧・rollback 条件、二重 worker 防止、切替後の再照合まで設計し、最小停止・データ欠落なしの実現性を示す。
4. **実本番 DB の再構築・移転・切替、新規有料環境の契約、破壊的変更は、Owner の明示承認が前提。** 本書は設計と合成データでの検証までを扱い、本番では実行しない。

## 6. 復旧証拠について

0064 の導入で使った復元証拠は登録63本の DB 用で、登録64本の 0065 の前提にならない。age 鍵は再要求しない。0065 を適用する場合に限り、`scripts/production-recovery-evidence-pre0065.ts`（登録64本・24時間以内・固定形式）を要求する。実データへの試験書込みは行わない。

## 7. 運用

- 団体の貸出・返却の入口は閉じたまま。通常の予約・貸出・返却には影響しない。
- **新規の団体入口は、0065 が入るまで開かない。** 在庫を押さえても貸出・返却ができない状態で運用を始めないため。恒久的な団体機能の削減や、手動貸出による完成偽装は行わない。
- 通知・既存団体の回復・UI・性能の作業は、これと独立に進める。
