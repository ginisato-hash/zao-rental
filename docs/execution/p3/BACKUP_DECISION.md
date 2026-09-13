# Production backup decision table — candidates, not SLA

P2の合成cold same-major PostgreSQL drill（81tables/180rows）は基礎証拠。off-host／暗号化／PITR／大容量／復旧要員／所要時間の本番証明ではない。P3は実provider／最終RPO/RTOを決定・接続しない。

| 判断 | 候補案 | 選定時に必要な証拠／Owner欄 |
|---|---|---|
| off-host | DBホストと障害／権限境界を分けた保管。必要なら別regionの複製 | 同一Mac／同一diskをoff-hostと呼ばない。地域／法務／復元経路____ |
| encryption | transit TLS＋保存時暗号、鍵管理をbackup書込み主体と分離 | 復旧担当が鍵を安全に取得できるか、失効／紛失時手順____ |
| PITR | 整合したbase backup＋連続WAL、欠損／遅延監視 | 選択時点への復旧／timeline、WAL archive失敗検知の実試験____ |
| backup頻度 | daily baseを起点に差分／WALを比較、migration直前は復旧検証済みpointを確保 | 実データ量と生成速度／保存費／restore実測で決定____ |
| retention | 比較候補7日／30日／90日。legal deletion／契約監査／素材原本は別分類 | 最終期間・廃棄承認・backup内個人情報の扱い____ |
| RPO | 通常候補<=15分／厳格候補<=5分、final未承認 | Squareが成功したがDBを失った範囲を照合する証拠。単なるarchive間隔では保証不可____ |
| RTO | 通常候補<=4h／厳格候補<=1h、final未承認 | 取得・復号・DB復元・検査・外部決済照合・app復帰・担当者到着を全て含める____ |
| restore drill頻度 | 月1回＋重要migration/provider変更前を比較候補 | 隔離環境・最新backupと旧世代・担当交代・不在時対応____ |
| credential separation | app／migration／backup writer／restore reader／鍵管理を分ける | 権限表、削除防止、緊急承認、旧credentialで接続不能____ |

release checklist：off-host取得hash→空の隔離先→復元→migration/schema/role/constraint/全table digest→在庫・confirmed保護・paymentUNKNOWN・監査の再照合→外部送信停止の確認→Owner signoff。失敗は公開停止。復元先から自動請求／通知／webhook処理を起動しない。backupは認証情報も含むためGit/CI/レビューへ送らない。設定・鍵・provider metadataはDBとは別の復旧対象に含める。

PostgreSQL公式ではPITRはbase backupと連続WALを使い、論理dumpだけではWAL replayの基礎にならず、手編集設定は別途保管が必要。[PostgreSQL18 PITR](https://www.postgresql.org/docs/18/continuous-archiving.html)（2026-09-13）。頻度／目標値はこの仕様から自動導出せず当店向けの候補としてOwnerが選ぶ。
