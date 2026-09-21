# Backup / PITR provider判断

Ownerの選定目標: RPO<=5分、RTO<=4時間、retention30日、月1回+重要migration前restore drill。off-host/暗号化/PITR必須。以下は候補比較であり契約/SLA/実測保証ではない。

| 観点 | Amazon RDS PostgreSQL | Neon PostgreSQL | 自営PostgreSQL+WAL archive（比較用） |
|---|---|---|---|
| off-host / encryption | managed backupをDBinstance外へ保管。KMS/transport/別account保存を選定 | managed historyと分離compute、暗号化/独立copyの要件を契約確認 | 専用backup host/object store、TLS/鍵管理を自身で構築 |
| PITR / 30日 | automated backup保持1–35日、指定時点の新instance復元。30日設定は可能 | 公式料金表の30日restore window対応planを確認。短い無料保持は不適合 | base backup+連続WAL、timeline/欠損監視/保存30日を運用 |
| credential separation | app/migration/backup/restore/KMSをIAM/DB roleで分離 | project管理とDB role・外部backup鍵を分離。planの監査権限を確認 | 全role・鍵・削除権限を自分で維持 |
| restore isolation | 新instance/別endpoint、通知/決済egressを遮断して復元 | 新branch/projectへ復元、branchへのcredentialと実送信遮断を確認 | 空cluster/別hostへ復元し外部送信を遮断 |
| cost | compute/storage/IO/backup超過/転送/KMS/監査/restore試験 | compute+storage+WAL history+branch+転送/試験。広告のtypical spendを当店見積にしない | VM/保管/WAL/回線と24h監視担当の労務 |
| 運用負荷 | infrastructure設定は中程度、復旧担当と実drillが必要 | Vercelから接続しやすい候補。pooler/role/extensionの相性を実証 | 高い。初回の無人運用基盤を追加しない方針では優先しない |

[RDS backup/restore](https://docs.aws.amazon.com/AmazonRDS/latest/gettingstartedguide/managing-backup-restore.html)、[RDS automated backup](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)、[Neon料金/restore window](https://neon.com/pricing)、[PostgreSQL18 continuous archiving](https://www.postgresql.org/docs/18/continuous-archiving.html)。2026-09-14参照、契約画面で再照合する。
選定候補はmanaged2案を先に比較。どちらも現PG18.4相当の必要機能/extension/role/grantsが通るか未確認。versionを黙って下げない。RDSでlatest restorable timeが概ね数分であるという説明も、RPO<=5分の保証ではない。復元待ち時間だけでRTO<=4時間とも判断しない。

## Owner選定時の必要入力

provider/plan/region、DB/変更WAL想定量、cold/warm性能、アクセス制限、30日PITR設定、別account/region保管、KMS喪失時の復旧担当、監査保持、月額上限。実データ量不明は不明のまま、承認された合成負荷で測る。

## 契約後の実受入（今回はNOT_RUN）

1. 隔離DBへ連番/時刻付き合成書込を行い、障害想定時点とlatest restorable pointの差からRPOを測る。archive欠損/遅延alertも確認する。
2. 別の空環境へ任意時点を復元。故障検知・担当者対応・鍵取得・DB起動・role/migration/digest・予約/在庫/決済照合・app復帰までをRTOに含める。
3. backup writerにrestore/削除万能権限を与えず、appにbackup/鍵管理権限を渡さない。復旧用credentialの実利用と失効を証拠化する。
4. 30日内の旧世代と直近を両方試験。期限後廃棄/法的保全と個人情報削除はOwner policyに従う。R2素材copyとPostgreSQL PITRは別対象。
5. 復元先のSquare/email/公開は停止状態。DB復元が古いからとUNKNOWN決済を再請求せず、providerとの照合後に別承認で復帰する。

P5の同一major cold restore成功は上記PITR/off-host/RPO/RTOの証明ではない。まだprovider契約・資格情報投入・実backupは行っていない。
