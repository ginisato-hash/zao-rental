# R2 — Owner確認と実接続受入

第一候補R2、実接続0。Cloudflare既存account/契約/権限/課金/保管地域は未確認。

## Ownerが後で確認する画面順

1. Cloudflare DashboardでZAOが使用を許可されたaccountか確認する。account横断/他projectのbucketを変更しない。
2. Storage & databases → R2 → Overviewで既存subscriptionの有無を確認。checkout/支払/有料化画面が出たらそこで停止しOwner判断。free allowanceは無制限無料の承認ではない。[公式開始手順](https://developers.cloudflare.com/r2/get-started/)。
3. Standard/IA、保存GB/月、書込Class A、読取Class B、IA取り出し、backup複製、CDN/purgeの費用を見積もり、月額上限/通知をOwnerが決める。R2 egress無料だけで総額0としない。[料金](https://developers.cloudflare.com/r2/pricing/)。
4. bucket作成前に地域要件を確認。APAC location hintはbest effortであり日本国内保証ではない。jurisdictionとhintを区別し、法務要件が不明なら未設定のまま止める。[Data location](https://developers.cloudflare.com/r2/reference/data-location/)。
5. Ownerが接続を承認してから専用test bucket/最小bucket権限/secret store/rotation担当を決める。raw credentialをローカル/export/PRへ複製しない。private originalにpublic access/r2.devを付けない。

## 実受入チェック（すべてNOT_RUN）

| 試験 | 期待結果 |
|---|---|
| private original / public derivative | original直URL拒否。公開権利を持つ合成derivativeだけ公開候補。実public化は別承認 |
| signed access / expiry | 未署名/期限切れ/違うkey拒否、署名URLをaccess log/analyticsへ保存しない |
| immutable hash | 同じhash/key+同じbytesは冪等、異なるbytesは拒否。実S3条件付要求と並行raceを確認 |
| rights revoke / revision | revoke後の新ticket/再release拒否、古いrevisionで公開状態を戻さない |
| purge receipt / cache invalidation | 確認済み対象keyだけpurge、receiptと外部複数経路の非取得を検証。R2削除成功だけでCDN消去としない |
| 既発行ticket | 実providerで失効可能性を確認。即時revoke不能なら最長expiryまでの露出を記録し、Ownerの許容判断なしに合格にしない |
| credential rotation | 旧/新keyを別version、operationごとの新resolver取得、旧key失効後拒否、未知結果は照合 |
| backup copy | 原本/権利/revision/metadata整合、暗号化と別保管先/別資格情報、hash一致、復元後も非公開 |
| cleanup | 試験IDとbucket/keyの所有照合。実素材/他projectに触れず試験用だけ片付ける |

既存 `r2-media.ts` / `media-backup.ts` のfixture証拠と、新しい実object/event証拠を別列に保存する。provider側credential/purge/署名の実性質をfixtureから推定しない。実写真・Salomon実資料のimport commitは今回未承認。
