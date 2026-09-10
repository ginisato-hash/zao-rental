# Codex承認済みtaskの実装
実行場所：Runnerが確保した専用worktree。task ID、承認spec hash、base SHA、allowed paths、受け入れ基準を確認してから着手する。入力が欠けたらBLOCKED。
必要なAGENTS.mdと指定domain文書だけを読む。taskの依存PRがmerge済みであることを検証し、未承認機能や他taskへ範囲を拡げない。
実装→unit/実DB/integration/適用可能なE2E→lint/typecheck/build→diff確認を行い、run IDで証拠を保存する。テストの緩和・skip・認可無効化で成功させない。
schema/API/lockfile/CI/policyに範囲外変更が必要なら、必要性と最小変更を提案して停止する。別agentのtreeを変更しない。
レビュー修正は指定headとfinding IDに限り、最大2巡。UNKNOWN外部操作は照合してから再試行する。実Square、prod、本番secret、勝手な課金/デプロイは禁止。
結果はschemas/task-result.schema.json相当。CIやreviewが未実行ならREADY_FOR_REVIEWでありDONEではない。実装agent自身が承認することはない。
