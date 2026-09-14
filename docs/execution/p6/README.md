# P6 External Acceptance — 接続前の判断と受入手順

2026-09-14 R2更新。[現在の接続前準備](R2_PREPARATION.md) と [設定名・Webhook監査](SQUARE_CONFIG_AND_RECEIVER_AUDIT.md) が現行。Square application/1件locationはOwner確認済み。Vercel Project作成・link後、Preview secret直接入力とdeploy承認の手前で止める。
実外部受入は全件NOT_RUN。P5のfixture/実ローカルDB成功を外部成功へ読み替えない。

R1のSquare Step1はOwner完了済み。旧手順は履歴として保存し、再作成を要求しない。
その後にsecret store、HTTPS receiver、Vercel、Square、R2、backupの順で、該当する判断だけを求める。
下記の資料ができたことは、接続・契約・権限・deployの承認ではない。

| 順序 | 資料 | 現在の状態 |
|---|---|---|
| 1 | [Squareを1画面ずつ確認](SQUARE_STEPS.md) | application OWNER_CONFIRMED |
| 2 | [Secret store / HTTPS receiverの比較](SECRETS_AND_RECEIVER.md) | Preview env候補、receiver NOT_CREATED |
| 3 | [Vercel direct実環境受入](VERCEL_ACCEPTANCE.md) | project作成/link承認、deploy未承認 |
| 4 | [予約確認の復旧配送・サポート](RECOVERY_OPERATIONS.md) | provider未選定、実配送0 |
| 5 | [R2実接続前後](R2_ACCEPTANCE.md) | account/契約/資格情報未確認、実要求0 |
| 6 | [Backup / PITR比較](BACKUP_PITR.md) | 実provider未選定、SLA未実証 |

P4で確定済みのBALANCED入力guest設定、Vercel direct候補、R2第一候補、RPO<=5分/RTO<=4時間/30日保持/月1回と重要migration前drill、独立coupon OFFは維持する。
税・販売開始終了日・清掃時間・正式NAP・法的最終文言・素材権利・Salomon実資料・実在庫・実スマホ・domain・本番deploy・Search Console・GBP・蔵王公式掲載はOWNER_PENDING。値を補完しない。

既存業務契約は正本のまま。2店舗、08:30–17:00、AM12:00返却/PM13:00開始、半日〜10日、同日再貸出禁止、HOLD600秒/延長なし、1組=1 Asset、POLE PAIR、WEARサイズ別数量、Premium exact/Regularモデル非確約、MULTIDAY遅延受取の元due/end/price/discount不変・未使用日返金なし。

R2は未定義だった接続前env schemaのみ追加。migration・機械policy・実決済runtimeは変更しない。PR3/Runnerは保留。
P5の最終CI/レビューはP5製品コードの証拠であり、このP6文書への新しい独立レビューではない。
historical staff-create HTTP500 / wear mixed transportは未解明のまま保持する。

実受入時の証拠は各行で `NOT_RUN / PASS / FAIL / OWNER_PENDING / EXTERNAL_PENDING` とし、日時、operator、承認記録、git SHA/tree、deployment ID、provider環境、試験ID、期待/実結果、停止/片付けを記録する。
secret、Cookie、raw recovery code、カード、Webhook生body、DB dump、実連絡先はGit/PR/log/analyticsへ保存しない。外部API回数と合成payment/refund件数はfixtureと別台帳にする。
