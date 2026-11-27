# 0065 団体の貸出・返却接続：特権経路の調査結果（Issue #47 / TD #7213588653 §2）

> **Owner指示（2026-11-27）：Neonサポートへの連絡・依頼は一切許可していない。絶対禁止。** 本書の§4は「仮に付与された場合の条件」を記録した参考であり、**送付・依頼の手順ではない**。誰もサポートへ連絡しない。0065 はこの経路が成立するまで未適用（保留）で、団体の貸出・返却と団体の入口は閉じたままにする。

状態：**本番は 0064 のみ（`custodyLink: NOT_APPLIED`）。0065 は未適用。** 本書は、本番で 0065 を適用できる唯一の正規経路と、それが成立するまでの扱いを固定する。

## 1. 本番の実測（READ ONLY・2026-11-27、秘密値なし）

neondb_owner の READ ONLY トランザクションで読み取った。書き込み0、ROLLBACK 済み。

| 対象 | 実測 |
|---|---|
| 接続主体 | `neondb_owner`（SUPERUSER ではない、CREATEROLE あり）。PostgreSQL 18.7 |
| `neondb_custody_executor` | NOLOGIN・NOINHERIT・非SUPERUSER。**メンバー（ADMIN含む）が0人** |
| owner のメンバーシップ | `neon_superuser`（grantor `cloud_admin`、ADMIN なし）、`neondb_role_admin`（ADMIN あり／SET あり） |
| `neondb_role_admin` | 各アプリロール（auth/ledger/hold/…/group 等）の ADMIN。**`custody_executor` の ADMIN は無い** |
| executor 所有の関数 | `rental_validate_loan` / `rental_apply_receipt` / `rental_stage_guard`（SECURITY DEFINER・search_path 固定） |
| owner 所有の関数・表 | `rental_loan_items` / `inventory_holds` / `ledger_assets` / `group_*` の表、`group_custody_hold_update`、`group_order_guard`、`group_consistency` |

## 2. なぜ owner の通常経路で 0065 が適用できないか

0065 は、executor 所有の `rental_apply_receipt` と `rental_stage_guard` の本体を置換する（`CREATE OR REPLACE`）。関数の所有者でも所有ロールの権限継承者でもない owner には、これが許されない（42501）。executor へ SET/INHERIT できる非SUPERUSERは存在しない。メンバーシップの付与はSUPERUSER（Neon の `cloud_admin`）だけができる。Neon は顧客に SUPERUSER を渡さない（[Neon: Roles](https://neon.com/docs/manage/roles/)、[Neon: Manage database access](https://neon.com/docs/manage/database-access)）。

## 3. 「executor 所有関数を変更しない互換設計」の評価（不採用）

TD の代案（既存 executor 関数を変更せず、owner 所有の新規関数や新しい最小権限 executor で団体を扱う）を検討した。**既存の安全境界を弱めずに成立する形は見つからなかった**。

1. 返却の効果（資産の店舗移動、PAIR の数量移動）は、`ledger_assets` / `ledger_poles` のガードが **`current_user = <db>_custody_executor` を直書き**で検査して許可している（0015、0033）。新しい executor や owner 所有の関数が同じ更新をするには、これらのガード本体を「第二の executor も許可」と書き換える必要がある。これは在庫の中核ガードの拡張であり、弱化と区別がつかない。
2. 既存の `rental_apply_receipt` は予約（`rental_bookings`）を `STRICT` で引くため、団体の貸出（予約なし）をそのまま通せない。擬似の予約行を作る案は、団体と予約を分離する仕様（Owner 仕様・TD §2）に反する。
3. 新しい executor を作ってそこへ関数の所有を移す案（role_admin が作成→owner へ一時付与→`ALTER FUNCTION … OWNER TO`）は、上の 1 の書き換えが必須で、同じ理由で採らない。

結論：団体の貸出・返却は、**既存の executor 所有関数を、所有者として置換する正規の特権操作**でのみ安全に成立する。

## 4. 参考：付与が成立する場合の条件（依頼ではない。連絡は禁止）

**理由**：本番 DB の `neondb_custody_executor` の所有関数を、DB 所有者が置換できるよう、期間限定の権限継承を付与してほしい。メンバー0人のロールへ、非SUPERUSERが自力で付与する手段が無い。

**対象**：Neon 本番プロジェクト（`curly-union-23141081` / ブランチ `br-long-king-azkou4fy` / DB `neondb`）。それ以外は触らない。

**実行してほしい操作（SUPERUSER で、各1回）**

```sql
-- 付与（0065 適用の直前）
GRANT neondb_custody_executor TO neondb_owner WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;

-- 撤去（0065 適用の完了報告の直後。必ず実行する）
REVOKE neondb_custody_executor FROM neondb_owner;
```

`INHERIT TRUE` が必要な理由：関数の所有権検査は「所有ロールの権限を持つこと」を要求するため、SET だけでは不足する。これは最初のブートストラップが executor 作成時に使った橋渡し（`scripts/production-bootstrap.ts`）と同じ形である。

**サポートに頼まないもの**：0065 は `ALTER FUNCTION … OWNER TO executor` を含み、移し先の executor が `public` スキーマの CREATE を持つ必要がある。インストーラが同じトランザクション内で `GRANT CREATE ON SCHEMA public TO executor` → 適用 → `REVOKE` し、スキーマ ACL が元と一致することを確認する（public スキーマは DB 所有者が管理する）。サポートの作業はメンバーシップの付与と撤去だけである。隔離PGの本番トポロジ再現（`tests/operations/production-0057-owner-apply.ts`）で、この1件の付与だけで 0065 が owner 1トランザクションで適用でき、通常の貸出検証関数が不変であることを確認済み。

**成功条件**
- 付与後、`pg_auth_members` に `neondb_custody_executor` の行が1行だけ（member=`neondb_owner`、`inherit_option=t`、`set_option=t`、`admin_option=f`）。
- 撤去後、`neondb_custody_executor` のメンバーが再び0人。

**中止条件**
- 付与が複数行になる、`admin_option` が真になる、対象が `neondb_owner` 以外になる、DB が違う、のどれか。
- 0065 の適用が失敗して全体が ROLLBACK された場合は、メンバーシップを撤去して終了（再試行は新しい承認から）。

**期間**：付与から撤去まで、1回の作業窓（目安30分）。この間、団体以外の本番導線は通常どおり動く。0065 は `ALTER TABLE rental_loan_items` を含むため、短時間の表ロックが入る。貸出が行われていない時間帯を推奨（本番は現在、団体の貸出が0件、通常の貸出は稼働中）。

## 5. 付与後の実施順（Claude H が実施。付与が確認できるまで実行しない）

1. READ ONLY で、付与の形（成功条件）を確認する。
2. 0065 専用の復旧証拠（登録64本の DB を対象、24時間以内、固定形式）を確認する（`scripts/production-recovery-evidence-pre0065.ts`）。**age 鍵の再要求はしない**（下記 §6）。
3. `npm run production:custody-link-preflight`（READ ONLY）で `ready: true` を確認し、`npm run production:install-custody-link` で 0065 を owner 1トランザクションで適用する（事前・事後に、executor 所有の3関数の所有者／ACL／SECURITY DEFINER／search_path、通常の貸出トリガ、`rental_inventory_blocks`、migration registry を読み戻して照合）。
4. 最小権限の付与（`custody` / `operations` への団体表 SELECT、準備表、executor への SELECT）。
5. サポートへ撤去を依頼し、撤去を READ ONLY で確認する。
6. `production:verify-group` が `custodyLink: APPLIED` と最小権限の完全一致を返すことを確認する。

## 6. 復元証拠について

0064 の導入で使った復元証拠は、登録63本の DB を対象とするもので、登録64本の 0065 の前提にはならない。age 鍵の再要求は行わない（Owner 指示）。0065 の復元の根拠は、次のどちらかで整える。

- Neon の時点復旧（保持期間内の restore）を、適用直前の LSN／時刻とともに記録する。
- 直近の暗号化バックアップ（Owner が検証済みの形式）と、0064 適用後の差分が団体表のみ（空）であることの照合。

どちらを採るかは、サポートの回答を受けて決める。**実データへの試験書込みは行わない。**

## 7. それまでの運用

- 団体の貸出・返却の入口は `GROUP_CUSTODY_NOT_ACTIVATED`（409）で閉じたまま。通常の予約・貸出・返却には影響しない。
- **団体の入口（新規申請）は、0065 が入るまで開かない。** 在庫を押さえても貸出・返却ができない状態で運用を始めないため。
- 通知・既存団体の回復・UI・性能の作業は、この待ちと独立に進める。
