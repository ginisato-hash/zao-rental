# Owner decisions required — P3 / not production approval

P3の内部実装と、実外部接続・公開の承認を分ける一覧です。**この表の推奨は未承認。空欄を自動採用しません。** 承認時は選択値・対象環境・担当者・有効日・対象commit／設定hash・許可操作を記録し、秘密値は記録しません。

| 判断 | 今回の提案／選択肢 | 承認前の状態・次に必要な証拠 |
|---|---|---|
| main保護 | Protect main /23161641をread-only照合済み | [実取得記録](production-p3-evidence/ruleset-23161641.json)。Owner設定を変更しない。公開前にも再確認 |
| guest security 8値 | 推奨案BALANCED：3600/86400/43200/600/86400/60/180/1200（秒／回、順序は詳細表） | [意味・選択肢](p3/GUEST_POLICY_PROPOSAL.md)。本番configは未設定。24h後の顧客再アクセスと送信済み個人情報保持の別判断が必要 |
| hosting／trusted ingress | Vercel直結、Cloudflare、専用reverse proxyを比較 | [信頼境界](p3/HOSTING_INGRESS_DECISION.md)。provider未選択、直接header採用不可 |
| Square Sandbox開始 | 接続手順・停止条件・11系統の再実行harness | [チェックリスト](p3/SQUARE_ACTIVATION.md)。アプリ・merchant/location・資格情報・URL・試験範囲の個別承認待ち。返金試験も別許可 |
| storage／CDN | R2、S3+CloudFront、Vercel Blob | [比較・費用入力欄](p3/STORAGE_DECISION.md)。契約・資格情報・外部アクセスなし |
| backup RPO/RTO | 通常案<=15分／<=4h、厳格案<=5分／<=1hを比較する候補 | [判断表](p3/BACKUP_DECISION.md)。最終SLA未決、cold local drillだけでは証明不可 |
| 税 | 区分・表示・端数の承認 | 未確認／chargeReady=false維持、請求確定不可 |
| 販売期間 | 対象シーズンと販売開始／終了 | 未設定、勝手に営業日を追加しない |
| coupon | 実コード・上限・併用・対象・期間 | 開発fixtureは実couponではない |
| 清掃時間 | wear洗浄・乾燥・検品の必要時間 | 未確定。返却受領だけで再貸出可能にしない |
| 正式NAP | 店名・住所・電話・店舗別表記 | 実情報の提供／照合待ち、SEOへ仮値を公開しない |
| 最終法的文言 | cancellation/refund/privacy／遅延受取 | MULTIDAY元料金・期限維持／未使用日返金なしは業務正本。最終公開文言はOwner確認 |
| 素材権利 | 写真・メーカー資料の利用範囲／期限／出典 | 未確認素材はprivate、撤回／キャッシュ残存条件を確認 |
| Salomon資料・実在庫 | メーカー資料と入荷証憑を分離 | [取込手順](p3/CATALOG_ACTIVATION.md)。単位／season不明BLOCK、店舗内訳不明unallocated。実commit未許可 |
| 本番domain／deploy | 上記provider・TLS・origin・secret保存先を選択 | 本番公開／外部トンネル未許可。公開直前にRuleset／CI再確認 |
| 実スマホ | iPhone Safari／Android Chrome各1以上、端末／OS／browser版を記録 | [現場手順・未実施票](p3/FIELD_DEVICE_CHECKLIST.md)。合成データ／承認済み到達可能環境が必要 |
| Search Console／GBP／蔵王掲載 | 公開後の権限・サイト所有権・正式NAP・申請担当 | 実登録／申請なし。公開承認後の外部作業 |

CI500は[過去観測と診断](p3/CI500_OBSERVATION.md)に保持。現在原因は不明。P3のPASSは、これら未完了項目の合格・本番公開・次PRのmerge許可ではありません。
