# Storage/CDN choice — no provider connected

既存PostgreSQL CMS／ProviderMediaStore／MediaProviderPortを維持する。metadata/revision/rightsが公開権威。原本と派生物はnamespaceだけでなく外部アクセスpolicyを分離し、originalを公開bucketに置かない。immutable key＋content hash、不一致overwrite拒否、rights/revisionの前後確認、短命private ticket、revocation後の新規ticket拒否と正確なpurge receipt、参照／保管／ticket期限確認後の削除が必要。既発行ticket・browser cacheは即時回収できると約束しない。

| 候補 | private／public・署名 | 撤回／immutable／backupの注意 | 費用比較に入れる項目 |
|---|---|---|---|
| Cloudflare R2 + 選択CDN経路 | originalはprivate。S3 presignはAPI domain用、custom domainと混同不可。派生物だけ承認後公開 | write-once key、hash確認をadapter側でも強制。CDN purgeの完了証拠が必要。別copy/backupを選定し、object versioningを未確認のまま保証しない | GB月、Class A/B、変換、Workers/CDN、backup運用。R2直接egress無料は他service全体無料を意味しない |
| S3 + CloudFront | private bucketと限定origin access、必要ならCloudFront signed URL。派生物の公開policyは別 | object key/versionとcontent hashを結合、invalidation完了を照合。version/retention/別保管と削除承認を設計 | region別storage、request、transfer/CDN、invalidation、KMS、replication/backup |
| Vercel Blob | private storeは認可済みserver経由、public derivativeと分離 | caching/削除反映を実測し、必要なpurge receiptが取得できなければadapter受入は未達。原本にpublic URLを流用しない | GB月、operation、download/transfer、Function/変換、別backup |

試算入力欄：original GB____／derivative GB____／月read/write____／download GB____／purge件数____／backup複製数____／権利保管期間____／運用工数____。数量・容量・金額は実資料がないため未記入。比較式はstorage＋operations＋transfer/CDN＋変換＋purge＋鍵管理＋backup＋運用。無料枠や現価格を将来契約へ固定しない。Ownerの月上限・請求主体・データ地域を先に確認する。

選定後の受入：外部匿名original拒否、失効／期限切れsignedアクセス拒否、同key異bytes拒否、rights撤回中の競合、正確なrevisionのpurge ACK、失敗時非公開維持、backup復元のhash一致。秘密URLを証拠へ貼らず、metadataと結果のみ記録。P3では契約／資格情報／request／deleteを行わない。

根拠（2026-09-13）：[R2 presign制約](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)、[R2課金項目](https://developers.cloudflare.com/r2/pricing/)、[CloudFront private access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-overview.html)、[CloudFront署名期限](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html)、[invalidation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)、[Vercel private storage](https://vercel.com/docs/vercel-blob/private-storage)、[Vercel料金項目](https://vercel.com/docs/vercel-blob/usage-and-pricing)。要件適合は実adapter試験前には保証しない。
