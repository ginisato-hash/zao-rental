# ZAO Rental — 自律実装開始パック v1.0
作成日: 2026-09-10 / 業務仕様基準: bootstrap v0.4

本パックは**実装の進め方・タスク・指示書**です。レンタルアプリ、常駐Runner、GitHub Actionsを実装・起動した成果物ではありません。業務仕様・料金は変更していません。referenceのv0.4 ZIPは入力原本と同一です。

## 最初に読む
1. IMPLEMENTATION_PLAN_JA.md — 推奨体制、順序、自律ループ、承認境界
2. TASKS.json — 19件の依存関係付き実装ワークパッケージ。全件PLANNED
3. prompts/CODEX_FIRST_RUN_JA.md — 実装用MacのCodexへ渡す最初の指示全文
4. prompts/CLAUDE_BASELINE_REVIEW_JA.md — 基盤・契約の独立レビュー
5. policies/execution-policy.draft.json — まだ有効化していない権限・停止条件案

## 配置
実装用Macに新しい専用ディレクトリを用意する。候補は `~/Projects/zao-rental`。実在・空き・originを確認してから使う。既存のZMI/RMS/BI/TASTE OF ZAŌや常駐プロセスには触らない。
同梱v0.4をアプリrepoルートへ展開する際は、外側の `zao-rental-bootstrap/` を取り除く。本パックの計画・指示書は `docs/execution/` 配下などへ整理してコピーする。パス変更時は相互参照も修正する。既存ファイルは無断上書きしない。reference ZIPや実在庫原本を二重コミットする必要はない。

## 何が確認済みか
コンテナ内でv0.4の設定・料金テスト27件を再実行して成功。32件の運用受け入れシナリオは文書のみで、実アプリでは未実行。GitHub照会ではこの接続から見えるrepoは0件。Mac環境・契約の認証・CLI起動・本番権限は未確認。evidenceを参照。

## 起動する順番
E00→E01→E02で、環境診断・最小基盤・自律ループの往復試験を行う。同時にE03の業務契約レビューを準備する。その後のタスクは承認された範囲だけREADYにする。
最初は自動マージも本番デプロイもOFF。E02の人工失敗テスト、独立レビュー、明示承認を経るまで常時実行を有効化しない。

## ファイルの扱い
schemasは機械判定用の出力契約案であり、PASS文言だけで安全性を保証しません。レビュー対象SHA、CI結果、権限、承認対象をRunnerが別途検証する必要があります。
