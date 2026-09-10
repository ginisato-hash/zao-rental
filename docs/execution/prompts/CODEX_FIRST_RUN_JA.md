実行場所：実装用MacのCodex。新規ZAO Rental専用projectで行う。既存のZMI/RMS/喜らくBI/TASTE OF ZAŌ、常駐用Macの稼働処理には触れない。

あなたは主実装担当です。目的は、レンタルアプリ全機能を一度に作ることではなく、承認済み仕様を実装・テスト・独立レビューへ流せる最小基盤を実際に作ることです。添付のexecution-v1パックと同梱bootstrap v0.4を読んでください。添付をこの端末で見つけられない場合は、アップロード/配置場所の指定だけを求め、ファイルを見たふりをしないこと。

今回の対象はE00とE01、およびE02の設定・実装案です。常時実行、自動merge、本番deploy、有料契約変更はまだ有効化しません。

1. 専用projectの絶対path、空き/既存git状態、GitHub owner/origin、codex/claude/gh、runtime、Postgresの実行手段、認証方式を確認する。秘密値の内容は表示しない。新規path候補は~/Projects/zao-rentalだが既存を上書きしない。
2. referenceのv0.4を検証して配置し、27件の既存testを再実行する。価格・営業・在庫ルールは変更しない。結果を実行ログとして保存する。
3. TypeScript/Next.js/PostgreSQLの最小構成と1つのWeb appを作る。公式情報と実環境から対応version/ORM/認証方針をADRに記録する。worktree毎のDB/port/seedを分離する。
4. setup、lint、typecheck、unit、実Postgres migration/integration、buildを再現可能にし、CIへ載せる。現段階に存在しない業務機能をtest skip等で完成扱いしない。
5. AGENTS.md/CLAUDE.mdに作業範囲・必要文書・証拠・停止条件を統合する。業務規則全文を複数ファイルへ複製しない。
6. E02として、承認taskの排他取得→codex exec→draft PR→CI→Claude review→最大2巡の修正→承認待ち、という最小RunnerとGitHub Actionの案を作る。保護されたpolicy、対象SHA、古いreview拒否、auth/quotaエラー停止を設計する。今はdisabled/dry-runにする。
7. branchを切り、権限がある場合だけdraft PRまで作る。mainへの直接push、既存schema破壊、price公開、実Square請求/返金、広範な権限付与、secretのチャット貼付は禁止。

不明点は全作業を止めず、独立して進められる部分を実装する。人にしかできない認証・owner指定・既存ディレクトリの衝突は必要最小限だけ尋ねる。追加API課金へ自動切替しない。

最後に、変更ファイル、実行したコマンドとexit code、testログ、base/head SHA、draft PR、未実行項目、Claudeレビューへ渡す要点、次に必要な人間の操作だけを報告する。計画の説明だけで終わらず、許可された基盤コードとテストを作成すること。
