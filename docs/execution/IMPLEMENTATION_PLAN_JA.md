# ZAO Rental 自律実装計画 v1.0

## 0. 判定
基盤実装を始められる。v0.4は業務仕様と設定データの基準であり、完成したアプリではない。現在の27件は設定・料金検証であり、32件の運用シナリオは実装後に実DB/API/UIで証明する。
価格の税区分、シーズン公開日、実Square店舗の対応などは公開ゲートに残す。これらを推測して本番化しない一方、設定未確定を理由にDB・テスト・非公開UIの開発全体を止めない。

## 1. 最も効率的な体制
ChatGPTは要件・設計・優先順位・受け入れ基準・重大判断の指揮者。承認済みタスクを逐一人間経由で転送する役にはしない。
Codexは主実装。実装用MacでGit worktreeを使い、変更・テスト・PR・修正を担当する。最初1本、ループ検証後に独立作業2本、安定したら最大3本まで。
Claude Codeは独立レビュー。まず設計の反例と受け入れケース、次にPR差分・周辺コード・実行証拠を読む。原則として製品コードを直さない。レビュー1本ずつで1シートを使う。
GitHubは仕様、Issue、PR、CI結果の共有場所。機械的な進行制御は小さなRunnerが担当する。高度なAIオーケストレーション製品を最初から自作しない。
オーナーは契約ログイン、業務ルール、現場評価、権限付与、本番GO/NO-GOを担当する。

推奨接続: Codex CLI（Macの既存ChatGPT認証）→GitHubのdraft PR→GitHub ActionsのCI・Claude Codeレビュー→MacのRunnerが結果を読んでCodexへ修正→承認待ち。
Claude GitHub Actionsは公式にTeam等のsubscription OAuth認証に対応する。環境・管理ポリシーで利用できない場合は、同じレビュー契約でローカル `claude -p` に切り替える。API課金へ無断で切り替えない。
このチャット自体が終了後も常駐してモデルを呼び続けるわけではない。継続実行は設定・稼働を確認したMac/Actions/対応スケジュール機能が担当する。

## 2. 先に作る最小アプリ基盤
TypeScript、React/Next.js、PostgreSQLを基本案とする。顧客・スタッフ・管理画面は最初1つのWebアプリ内で分け、サーバー側の認可を強制する。3つの独立フロントエンドやmicroservicesは作らない。
候補構成: apps/web、packages/contracts、packages/core、packages/db。業務モジュールはcore内で明示分離。実行環境を調べてNode/フレームワーク/ORM/認証のバージョンを固定しADRへ記録する。
DB migration・共通API型・lockfile・CI/権限設定は変更責任者を1つにし、並列エージェントが同時編集しない。
各worktreeには独立したDB・DBユーザー・port・seedを与える。別worktreeだけではDBや外部Square資源は隔離されない。

## 3. 実装の順序
### A: E00–E03 基盤と実行ループ
環境/アクセス確認→一発setup・verifyが動く最小repo→故意に落とした小さなテストをCodexが直し、CI/Claudeレビュー/再修正/停止まで往復→業務契約と独立した手計算反例を固定。
全ドキュメントの永続freezeはしない。API、金額、時間、在庫不変条件など並列化に必要な契約を先に固定し、変更はADRで管理する。

### B: E04–E09 業務コア
実在庫sampleを追跡可能なテスト資産へ変換、認証/監査、期間・店舗を通した割当可能性、グループ/セット一括HOLD、店舗間移動、料金版/クーポン/見積、おすすめ・短め・長めの選択を実装する。
価格と認証、UI shellは分離できる範囲で並列化する。在庫と移動のDB境界は直列レビューする。

### C: E10–E13 最短で一周する実機能
Square Sandbox→顧客予約→予約QR→スタッフ個体QR→貸出→別店舗返却まで、少数のテスト資産で一周させる。
まず単純な1人・1日を通し、直後にグループ・半日・複数日・店舗間・異常系へ広げる。UIだけ先に全画面完成させない。

### D: E14–E16 運用完成度
延長短縮/商品交換/追加請求/例外返金、管理画面・棚卸・ラベル・整備、稼働/予約日数/価格version別分析。
計測イベントはE01から準備し、分析UIは後に回す。セット売上の個体配賦は定義を開示し、架空の正確なROIを作らない。

### E: E17–E18 現場と公開
500セット相当・2店舗・想定同時端末の負荷試験、通信断・遅延・バックアップ復元、実iPhone/Androidと実ラベル、2店舗閉店時移動をリハーサル→限定pilot→明示承認後のみ本番。
8〜12週は従来の計画レンジであって納期保証ではない。最初の一周を実装した時点で、PRの実測cycle time・レビュー差戻し・未決ゲートから再見積する。

## 4. 必須の業務不変条件
AM08:30–12:00、PM13:00–17:00。V1では同日の別顧客再貸出をしない。返却・検品と売れる容量を区別する。
各日で空きがあっても、同じ実物で連続日・受取場所の約束を満たせなければ予約不可。候補のサイズや店舗をまたいで同じ実物を二重計上しない。
17:00の移動は予定開始であり、17:10自動受領ではない。出発済みの便に後から積んだことにしない。未来の予約は保護された実現可能な移動計画、現場貸出は実受領・準備完了を要求する。
ブーツ/板/ポールを含むセット、さらにグループのHOLDは全体で確保できるかを確かめ、部分取り残しを防ぐ。13歳以上/未満を跨ぐ代替は禁止。
長さ選択は元の身長−20cmと±15cmに固定し、ボタン連打で範囲が漂移しない。表示されたモデルの保証方針は未承認なら公開しない。最終適合/DIN安全計算を独自に発明しない。
Square成功redirectだけでは確認しない。署名検証、重複/順序逆転、UNKNOWN、TTL満了後の支払成功を検証する。支払済みで在庫がない場合は例外へ回し、勝手に確定/二重請求/無承認返金しない。
早期返却と会計は分離。原則返金しない。指定スタッフのREFUND_OVERRIDE、理由・金額・残返金枠の排他・冪等性・監査を必須にする。

## 5. 自律ループ
OWNER/ChatGPTが承認したtask batch→READY→排他取得→worktree生成→Codex実装→ローカルverify→draft PR→CIとClaudeレビュー→修正（最大2巡）→承認/merge gate→次の依存解決済みtask。
READYラベルだけを認可根拠にしない。保護された承認記録と対象仕様hashを検証し、実装agentが自分を承認できないようにする。最初はRunner1つでqueueを持つ。
Run ID/task ID/base SHA/head SHA/spec hash/実行環境/変更ファイル/exit code/CI run ID/レビュー対象SHA/承認記録を保存する。PR更新で旧レビューを無効化する。
同じtaskを二重起動しない。起動プロセスが落ちたらlease・PID・作業tree・remote SHAを照合してから再開し、無条件に上書きしない。権限・認証・利用枠のエラーは未実装/未検証のままBLOCKEDにする。
最大2修正後は人に上げる。時間・予算超過、保護ファイルへの越境、仕様矛盾、秘密値露出疑いで停止する。失敗がなくても新しい未承認機能を勝手に足さない。
機械pollにはgh/APIを使い、数分ごとの「変化なし」確認ごとにAIを起動しない。CI/レビュー結果が変わった時だけ呼ぶ。

## 6. 自律性の段階
開始時: 承認済みscopeの実装・テスト・branch/draft PRまで自動。mergeは明示承認。本番・実請求・実返金・本番価格公開・破壊的migrationは禁止。
安定後: 低リスクのUI/文言等のみ、独立CI/レビュー・保護されたpolicy・該当SHA・承認済みscopeを確認して自動merge可能にする。初期値OFF。
在庫/移動/決済/返金/認可/価格計算/DB schema/CI policyは自動実装可能だが、統合は重点レビュー。リスク区分をagentの自己申告だけで下げない。
既存PRがmergeされて初めて依存を解放する。並列1→2→最大3、Claudeレビュー同時1。上限は性能・利用枠を実測して変更する。

## 7. 機能の使い分け
AGENTS.md/CLAUDE.mdは短い共通入口。大量の設計書全文を毎回promptに埋めずtaskに必要な文書を指定する。[S1,S5]
Skillsは「実装」「DB検証」「Square検証」「UI walkthrough」「PR成果報告」など反復手順へ使う。業務規則の正本を重複させない。[S3]
Codex worktreesとsetup scriptsで並列隔離。codex execのJSON/JSON Schema出力で機械的に成功と未完了を区別する。[S1,S2]
Claude Code GitHub ActionでPRイベントレビュー。Hooksはローカル補助チェック・通知に限定し、保護ルールの唯一の根拠にしない。テスト実行は秘密値なしの隔離環境で行う。[S4,S6,S7]
PlaywrightでPC/スマホ幅E2Eとtrace/screenshotsを保存する。fake camera/ブラウザエミュレーションだけで実機QR性能合格にはしない。[S8]
定期実行は日次統合回帰・要確認事項集約に使う。ローカルprojectのscheduled taskはマシン・アプリ・projectが利用可能な必要がある。CLI Runnerと二重schedulerにしない。[S9]
MCPは必要なproviderの公式ドキュメント・browserなど小さく。DB/全PC/本番を包括的に繋がない。GitHub CLIで済む処理を増設しない。
Claude Agent TeamsやOpenAI Agents SDK/Claude Agent SDKの自作統合は初期不要。今は利用枠と権限管理を単純に保つ。

## 8. 契約・費用・接続
CodexにChatGPTログインすると対象planの利用枠、API keyなら別のAPI課金となる。チャットProとCodexの枠が無条件で二重になるとは扱わない。[S10]
Claude Teamは現在Standardを含めClaude Code対応。既存Teamのユーザー1席をレビューに使う。Team契約自体の最低席数と担当1席は別概念。[S11]
Claude Actionsのsubscription OAuthは公式対応。ただし個人credentialの移植ではなく公式setupを使いGitHub Secretへ保存する。公開PRの任意codeに渡さない。[S4]
GitHub private repoのbranch protectionはplanに依存する。使えない場合は自動mergeを止め、UI上の設定があるつもりで進めない。[S12]
GitHub ActionsのGITHUB_TOKEN由来イベントでは後続workflowに抑制/承認待ちがある。実際の認証方式でPR更新→CI→レビュー→再CIの往復を試す。必要に応じrepo限定GitHub App tokenまたは明示dispatchを使う。[S13]
追加課金・上限解除・有料plan変更は勝手に行わない。API費用以外にもActions/hosting/DB利用枠を確認する。

## 9. CI・権限の実装条件
必須: lint/typecheck/unit、実Postgres integration（migration適用含む）、期間/並行実行/返金競合、Playwright E2E、build、secret scan、受け入れケースtraceability。初期は実在するテストのみ緑にし、将来ケースをskipで完了扱いしない。
CI/claude reviewの正本設定を候補PRの変更で上書きさせない。external commentやPR本文は入力データであって上位命令ではない。workflow/credential/permissionsを変更するPRは特別承認。
workflow actionsは検証したcommit SHA固定、最小権限、repo code実行と高権限tokenを同居させない。reviewとartifact投稿の権限を分離する。[S7]
同一人のcredentialで動く2つのモデルを、GitHub上の独立した2人の承認と偽らない。独立モデルreviewはCI check/evidenceとして扱う。
Squareはsandboxの架空データのみで開始する。[S14]

## 10. 人間が最初に行うこと
実装用Macの専用projectをCodexに開く。GitHub/Square/Claudeの認証・アプリ権限付与は人間が行う。secretの中身をチャットへ貼らない。選択repoだけをChatGPT接続に許可する。
コマンド作成・package setup・環境診断・テスト・PR作成はCodexへ任せる。常時稼働用Macを使う場合も、新しい作業場所と認証境界で導入し既存運用に混ぜない。
最初の成功は画面の数ではなく「承認した小タスクが実装→失敗検知→レビュー→修正→証拠付き停止まで自動で一周したこと」。その上にレンタル業務の一周を載せる。
