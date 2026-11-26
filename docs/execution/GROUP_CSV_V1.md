# GROUP_CSV_V1 団体予約 身体サイズCSV契約

正本: GitHub Issue #47 コメント 7197143646 の B2。実装: `packages/contracts/src/group-csv.ts`、試験: `tests/unit/group-csv.test.ts`。
DB・HTTPルート・既存画面には依存しない純関数モジュール（カタログは引数）。後続の招待ルート/UI/管理画面がこれを呼ぶ。

## 取扱い
- 行は本人に紐付く**身体データ（身長・体重・足長・年齢）**であり、**未成年を含み得る**。アクセス制御・保存期間の保護対象。
- 顧客CSVの**原本は保存・ログしない**。呼び出し側は解析結果（`GroupCsvRow`）の必要項目のみ保管する。エラーの `detail` はセル文字列を含み得るため、ログへ出さない。
- 生年月日・個人メール・カード情報の列は存在しない。未知列（例 `dob`, `email`）は `UNKNOWN_COLUMN` で全体拒否。
- セル内のHTML/URL/式は**実行・解釈せず文字列のまま保持**する。表示側は必ずエスケープする（`dangerouslySetInnerHTML` 禁止）。

## 列定義（安定キー）
受理するヘッダ名: 安定キー、JA名、EN名（NFKC・大小無視・前後空白無視の厳密map。曖昧一致なし）。順序自由。

| キー | JA名 | EN名 | 必須条件 | 値 |
|---|---|---|---|---|
| member_id | メンバーID | Member ID | 任意 | 新規は空欄。再importで既存行を指す時のみ。`^[a-z0-9_-]{1,24}$`（recommendation契約の key と同形）。名前をIDにしない |
| participant_label | 参加者表示名 | Participant label | 任意 | 40文字まで。実名不要 |
| sport | 競技 | Sport | 必須 | SKI / SNOWBOARD / WEAR |
| equipment | 用品 | Equipment | 必須（WEARは空欄） | `SET` または `SKI,SKI_BOOT,POLE`（SKI系）/ `SNOWBOARD,SNOWBOARD_BOOT`（板系）をセミコロン区切り。順序は正規化 |
| tier | グレード | Tier | 必須（WEARは空欄可=STANDARD） | REGULAR / PREMIUM（WEAR行はSTANDARD） |
| age_at_start | 貸出開始時年齢 | Age at start | スキー板を含む行・PREMIUM行 | 整数 0-120。13歳以上=成人（recommendation契約と同一境界） |
| height_cm | 身長(cm) | Height (cm) | 板/ポールを含む行 | 整数 50-250（`profileFields` 由来） |
| weight_kg | 体重(kg) | Weight (kg) | スキー板を含む行のみ | 整数 5-300 |
| foot_cm | 足の実測長(cm) | Foot length (cm) | ブーツを含む行 | 5-50、小数1桁（靴サイズ表記ではなく実測） |
| skier_type | スキーヤータイプ | Skier type | スキー板を含む行のみ | TYPE_I / TYPE_II / TYPE_III（`I`,`タイプ1` 等の別名可） |
| premium_model_code | プレミアムモデルコード | Premium model code | PREMIUM行のみ（他は空欄） | 渡された catalog の code。競技一致必須 |
| jacket_size / pants_size | ジャケットサイズ / パンツサイズ | Jacket size / Pants size | WEAR行、wear_addon=YES行 | catalog のサイズ（大小無視、catalog表記へ正規化） |
| wear_sport | ウェア競技 | Wear sport | WEAR行 | SKI / SNOWBOARD。追加ウェアは空欄なら競技と同じ |
| wear_addon | ウェア追加 | Add wear | 任意 | YES/NO/はい/いいえ 等。空欄=NO。WEAR行は常にウェア |

必要性の判定は `profileFields(sport, undefined, items)`（SETは `profileFields(sport,null)`）を再利用。不要な列に値がある場合は**エラーにせず `VALUE_IGNORED` 警告**を返し値は返却しない（無言dropなし）。`age_at_start` が不要かつ空欄の行は `adultAtStart: null`（後段で成人区分を確認すること）。内部UUID（variant/model id）は契約に含めない。`groupCsvRowToProfileDraft` が recommendation の `Profile` 相当ドラフトへ変換し、variant id / modelSelection / wearSelection の解決は呼び出し側 catalog が行う。

## CSV例（EN、合成値）
```
Member ID,Participant label,Sport,Equipment,Tier,Age at start,Height (cm),Weight (kg),Foot length (cm),Skier type,Premium model code,Jacket size,Pants size,Wear sport,Add wear
,Guest 1,SKI,SET,REGULAR,34,172,65,26,TYPE_II,,,,,
,Guest 2,SNOWBOARD,SNOWBOARD;SNOWBOARD_BOOT,REGULAR,28,165,,24.5,,,,,,
,Guest 3,WEAR,,STANDARD,,,,,,,M,M,SNOWBOARD,
```
実物は `buildGroupCsvTemplates(catalog, lang)` が生成（空テンプレート / 別の合成記入例 / 列説明と現行catalogのコード・サイズ）。ファイルはUTF-8 BOM・CRLF。

## 公開API
- `buildGroupCsvTemplates(catalog, 'JA'|'EN'): {files:{empty,example,legend}:{filename,content}}`
- `parseGroupCsv(bytesOrString, catalog, {allowCp932?}): GroupCsvParseResult`（全か無か。失敗時 `rows=[]`）
- `diffGroupCsv(existing: ExistingGroupMember[], incoming: GroupCsvRow[], 'REPLACE'|'ADD'): GroupCsvDiff`
- `serializeGroupCsvRows(rows, lang)`（画面編集後のエクスポート。出力時にformula injection対策）
- `groupCsvRowToProfileDraft(row, key)`、`describeGroupCsvIssue(error, lang)`、`catalogSizesFromVariants(variants)`
- 低レベル: `decodeGroupCsv`, `readCsvRecords`, `csvSafeText`, `serializeCsv`、定数 `GROUP_CSV_MAX_BYTES=1MiB`, `GROUP_CSV_MAX_ROWS=100`, `GROUP_CSV_MAX_CELL_CHARS=200`, `GROUP_CSV_MAX_LABEL_CHARS=40`, `GROUP_CSV_MAX_ERRORS=200`

## 文字コード・形式
- UTF-8、UTF-8 BOM（除去し `BOM_STRIPPED` 警告）。UTF-16は `UNSUPPORTED_ENCODING`。NULバイトは `NUL_CHARACTER`。
- UTF-8として不正な場合のみ CP932(Shift_JIS) を厳密変換（fatal）。置換文字、および `\ ~ ¥ ‾ 〜 ～ ＼ ∥ － ￠ ￡ ￢` 等の解釈が曖昧な文字は `AMBIGUOUS_CP932_CHAR`（生の0x5C/0x7Eバイトを含む）。成功時は `ENCODING_CP932` 警告。
- RFC4180: 引用符、`""`、セル内カンマ/改行、CRLF/LF/CR。引用符の誤配置は `STRAY_QUOTE`、閉じ忘れは `UNTERMINATED_QUOTE`。行番号は物理行。
- 参加者表示名などの単行セルに改行/制御文字は不可（`CONTROL_CHARACTER`）。
- 全空白行は `EMPTY_ROW_SKIPPED` 警告でスキップ（上限100行には数えない）。セル数がヘッダと異なる行は `ROW_CELL_COUNT_MISMATCH`。
- 出力: `= + - @ TAB CR`（全角 `＝＋－＠` 含む）で始まる文字列セルは先頭に `'` を付与。取込側は `'` を剥がさない（ラベルは原文保持）。数値は生のまま出力。

## エラーコード表
エラーは `{code, line, column, detail?}`（`line`=物理行、ファイル全体は null、`column`=安定キー）。最大200件、超過は `truncated:true`。

| 区分 | コード |
|---|---|
| ファイル | FILE_TOO_LARGE, UNSUPPORTED_ENCODING, INVALID_ENCODING, AMBIGUOUS_CP932_CHAR, NUL_CHARACTER, EMPTY_FILE, UNTERMINATED_QUOTE, STRAY_QUOTE, TOO_MANY_ROWS, NO_DATA_ROWS |
| ヘッダ | MISSING_HEADER（sport/equipment/tier）, UNKNOWN_COLUMN, DUPLICATE_HEADER, EMPTY_HEADER |
| 行/セル | ROW_CELL_COUNT_MISMATCH, CELL_TOO_LONG, CONTROL_CHARACTER, REQUIRED_VALUE_MISSING, INVALID_ENUM, INVALID_MEMBER_ID, DUPLICATE_MEMBER_ID |
| 数値 | NOT_A_NUMBER（全角数字・漢数字・式・指数表記）, AMBIGUOUS_UNIT（cm/m/kg/lb 等の単位文字）, HEIGHT_LOOKS_LIKE_METRES（1.7 等）, NOT_AN_INTEGER, OUT_OF_RANGE, FOOT_PRECISION |
| カタログ/契約 | UNKNOWN_MODEL, MODEL_SPORT_MISMATCH, UNKNOWN_SIZE, UNKNOWN_ITEM, DUPLICATE_ITEM, ITEM_SPORT_MISMATCH, ITEMS_INCOMPATIBLE（`singleItemsCompatible`）, SET_COMBINED, PREMIUM_NOT_ALLOWED, PREMIUM_REQUIRES_ADULT, PREMIUM_MODEL_REQUIRED_ONLY_FOR_PREMIUM, TIER_NOT_ALLOWED, WEAR_FIELDS_REQUIRED |
警告: EMPTY_ROW_SKIPPED, VALUE_IGNORED, DUPLICATE_LABEL（同名参加者は許容。行はIDで区別）, BOM_STRIPPED, ENCODING_CP932。

## 再import差分
3者比較（`baseline`=前回CSV/サーバ受理値、`current`=画面上の現在値、`incoming`=新CSV）。
- REPLACE: 既知 member_id は更新。画面編集と同一項目をCSVが別値にした場合は `CONFLICT/FIELD_CONFLICT`（上書きしない）。CSVが baseline と同じ項目は画面編集を保持（`keptScreenEdits`）。CSVに無い既存行は `REMOVE`（画面編集済み/baselineなしは `hasScreenEdits:true`、`clean:false`）。member_id 空欄は `ADD`。
- ADD: 既存行は変更・削除しない。既存 member_id を持つ行は `CONFLICT/ID_EXISTS_IN_ADD_MODE`。
- どちらも既存に無い member_id は `CONFLICT/UNKNOWN_MEMBER_ID`（ファイルからIDを採用しない）。`baseline` 無しの差異は全て衝突。
- 出力順はCSV入力順、続いてREMOVE。名前によるマッチなし。適用処理（DB反映）は本モジュール外。

## 限界・未実装
- DB/HTTP/UI/招待ルート/権限/保存期間の実装は含まない（後続）。行ID（member_id）のserver発行も後続。
- カタログ（premium code・ジャケット/パンツサイズ）は呼び出し側が現行値を渡す。equipment の個別サイズ選択はCSV列に無い（推薦・在庫照合が決める）。
- CP932は Node ICU の `shift_jis` デコーダに依存（試験で確認）。NEC/IBM拡張文字の同一Unicode重複は検出対象外（Unicode上は同一のため）。
- `wear_addon` の意味（同一参加者に付随するウェア。`wear_sport` 空欄時は競技に従う）はB2の「wear追加フラグ」記述からの解釈。B1の状態機械側で別行（WEAR member）へ展開する想定。解釈が異なる場合は要調整。
- 100名の実ブラウザ/本番相当build/隔離PGでの性能・負荷は未測定（NOT_RUN）。本モジュールは100行で入出力とも同期・O(n)。
