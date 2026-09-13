# Owner field device checklist — NOT EXECUTED

各端末で別票を記録する：iPhone Safari____ OS/browser版____、Android Chrome____ OS/browser版____、portrait/landscape____、Wi-Fi／mobile____、日時____、release head____、実施者____、合成データseed____。全行初期状態NOT_RUN。PASSには実端末での操作結果が必要。390px／Chromium touch／canvas cameraは代替証拠ではない。

前提：Owner承認済みで端末から到達できる**非公開HTTPS試験環境**、合成staff／guest／Assetと限定店舗権限。現Macのlocalhostをスマホlocalhostに置換しても接続できない。LAN公開・tunnel・外部URL・実credential・実決済はP3で設定しない。端末到達環境が未承認ならここでNOT_RUNのまま。画面録画／画像には実個人情報・Cookie・復旧codeを含めない。

| 操作（iPhone／Android両方） | 期待結果 | iOS／Android／証拠 |
|---|---|---|
| 私用／共有端末を区別し、予約入力→日程／2店舗→推薦→明示選択→HOLD／見積→再読込 | 合成予約、金額はserver結果。HOLD600秒は再読込で延長しない。通常決済は未接続表示 | NOT_RUN / NOT_RUN / ____ |
| 20人の年齢・身長・足・道具／wear混在を入力、途中保存し戻る | 抜け・別人への候補混入なし、横はみ出し／キーボード隠れなし。入力時間／HTTP数／429を実測 | NOT_RUN / NOT_RUN / ____ |
| 復旧codeを画面上で安全に保存、cookie消失相当の別private tabで復旧、応答喪失後同一request再送 | 新規HOLD作成なし、同じ保存済み結果。code再利用／他人アクセス拒否。絶対期限後は復活しない | NOT_RUN / NOT_RUN / ____ |
| 開発用に確認済みの予約QRを表示・再読込・明るさ変更 | 予約IDだけ。読取だけでは権限／個人情報閲覧を開放しない | NOT_RUN / NOT_RUN / ____ |
| スタッフログイン→返却店舗→カメラを開いたまま複数予約のAssetを連続読取→一括確定 | Assetからloan cycle照合、正常／要確認分離。スキー／boots左右同ID1回で1組。別Asset部分返却維持 | NOT_RUN / NOT_RUN / ____ |
| 同じIDを両側から再読取、別端末でも同じ対象を確定 | 重複数／在庫増加なし。古いcycleへ誤適用なし | NOT_RUN / NOT_RUN / ____ |
| camera拒否→設定で許可／camera無し条件 | 拒否を表示、許可されるまで保存／読取成功にしない。手入力のIDも同じserver検証 | NOT_RUN / NOT_RUN / ____ |
| flight mode／通信断→scan／確定→復帰・再読込 | 通信未確認は未保存表示。同じkey／保存済み候補を照合、二重返却なし | NOT_RUN / NOT_RUN / ____ |
| 低速回線で照合を待つ間に再タップ・向き変更・background復帰 | 待機表示、二重submitなし。画面回転後も確認前データを完了扱いしない | NOT_RUN / NOT_RUN / ____ |
| Mountain貸出をOnsenで受領（受領担当の有効scope）、権限剥奪後も試す | 実受領店舗／履歴・要対応を記録、権限失効は拒否。即再貸出／自動返金なし | NOT_RUN / NOT_RUN / ____ |

終了：logout、camera indicator消灯、試験browser終了、対象だけを既存手順で停止。失敗時は再送key／request相関ID等の非秘密metadataと操作順、端末、時間、エラーcodeだけを記録。CI500再現なら歴史的観測へ関連付ける。CWVは実端末の操作／ネットワーク／計測法／LCP-INP-CLSを記録し、lab値とfield集計を混同しない。P3で現場値は未測定。
