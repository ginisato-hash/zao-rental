# P85 要素分解表（Palaceトップ実画面）

生成モック2案は不採用、根拠に使わない。ここにある値は実画面の実測だけ。測れなかった値は「未取得」と書き、ブランドの一般的な印象では埋めていない。

## 取得条件（固定）

- 要求URL・最終URL：`https://palaceskateboards.com/`（このブラウザではリダイレクトなし）
- 取得日時：2026-10-10 02:05頃 BST
- ブラウザ：Claude内蔵ブラウザ（Chromium、Mac UA）、DPR 1
- 画面幅：PC 1440×900、モバイル 390×844（エミュレーション）
- 地域：**未取得**。この回のキャンペーンにはSINGAPOREが含まれていた。shopサブドメインの地域判定は確認していない。
- Cookieバナー：同意していない（「ACCEPT ALL」の1択で、同意操作は承認対象のため）。全画面にバナーが写っている。
- 既存の同条件の証拠：手元になし（再利用なし）。

## 根拠画面（`.local/p85/`）

| ファイル | 状態 | 画像サイズ | sha256（先頭16桁） |
|---|---|---|---|
| 01-pc1440-initial.jpg | PC初期 | 800×500（ツール縮小） | 1baba20479dc5c49 |
| 02-pc1440-footer.jpg | PCフッター（scrollY 376） | 800×500（ツール縮小） | 964aca50069bb3cf |
| 03-m390-initial-loading.jpg | モバイル初期（画像読込前） | 780×1688 | b5e49303c926f1eb |
| 04-m390-initial.jpg | モバイル初期 | 195×422（0.5倍） | db1c058c1e0d77ca |
| 05-m390-menu-open.jpg | モバイル メニュー開 | 234×506（0.6倍） | 4863ccb92b20c4b9 |
| 06-m390-footer.jpg | モバイル フッター（scrollY 742） | 234×506（0.6倍） | c815e40d3e12d82f |

画像はツールの縮小JPEGで、等倍PNGは**未取得**。寸法の根拠には画像ではなく下表のDOM実測値（getComputedStyle / getBoundingClientRect）を使う。CDPの実使用フォント（getPlatformFontsForNode）は**未取得**（この環境では使えない）。

## Cookieバナーで隠れた範囲（未観測）

バナー自体の矩形は実測していない（未取得）。下の範囲は、画面上での目視と、バナー内要素の実測位置から割り出した概略。この範囲の下にある主画像・フッターの内容は**未観測**として扱い、要素表の値には含めていない。

| 画面 | 隠れた範囲（CSS px、概略） | 根拠 | 影響 |
|---|---|---|---|
| 01 PC初期 | 下端中央 x 約395〜1045、y 約800〜880 | ACCEPT ALL 実測 x 929・y 819・107×41／HEREリンク y 844 | 主画像の下中央部分は未観測 |
| 02 PCフッター | 下端中央 同上（バナーは画面に固定） | 同上 | フッター下段（著作権の行の中央・WORLD SHOP より下）は未観測 |
| 04 モバイル初期 | 中央 x 20〜370、y 約353〜490 | ACCEPT ALL 実測 x 40・y 430・107×41／HERE y 398 | 主画像の中央（顔・用品が来やすい位置）は未観測。トリミング判断にこの画面は使わない |
| 05 モバイル メニュー開 | メニューパネルが前面にあり、バナーはその下 | 画面目視 | メニュー要素は観測できた（パネル下の主画像は未観測） |
| 06 モバイル フッター | 中央 y 約353〜490 | 同上 | WEB SHOPS列の上部（AUSTRALIA〜JAPAN SHOP）は未観測。列構成はDOMのテキストで確認済み |

## 要素表

列：観察した特徴／根拠画面・要素／実測値／ZAOでの置換内容／意図的な差分

| 要素 | 観察した特徴 | 根拠画面・要素 | 実測値 | ZAOでの置換内容 | 意図的な差分 |
|---|---|---|---|---|---|
| ロゴ | 黒ピル内の左端に置かれたワードマーク。実体はthree.jsのcanvas（立体的に動くロゴ） | 01/04、`header a[aria-label="Palace Skateboards home"]` 内 canvas | リンク枠 118×60（PC）、108×60（モバイル）。ロゴ枠 88×20（aspect 22/5）、canvas 88×88。padding 0 10px 0 20px（モバイル 0 0 0 20px）。色 #fff | 受領ロゴ 2.png（横長「SALOMON rental station ZAO」）の透過トリミング版・白版を同じ枠位置に置く。縦横比は維持 | 3D canvasは採用しない（静止画のロゴ）。2.pngの横長比に合わせて枠幅は変わる（実測後に確定） |
| メニュー（PC） | 画面上部中央に固定した黒いピル。ロゴと4リンクを横一列 | 01、`header` > `div.rounded-full` | header：fixed、top padding 20px、高さ80。ピル：398×60、x 521（中央）、背景 #000、border-radius 完全な丸（9999px相当）、overflow hidden。リンク：16px / 400 / lh 24px / 大文字表記 / 字間 normal / 白、padding 0 10px（両端は20px）、高さ60。hover：`hover:text-grey-400`、transition color .15s cubic-bezier(.4,0,.2,1) | 4リンクをZAOの既決導線に置き換える。文言はTD原案（P85 §4）のBOOK RENTAL / RENTAL RATES 等から、既存ルートと一致するものだけ使う | リンク数・文言はZAOの導線数に従う（4件とは限らない）。CARTに当たるものは設けない（予約フローにカートはない） |
| メニュー（モバイル） | ピルにロゴと「MENU」ボタン。開くと全画面に近い半透明パネル | 04/05、`button[aria-label="Open menu"]` とパネル | ピル 189×60、x 101。MENU：padding 0 20px、81×60、16px/400、白。パネル：fixed、inset 10px（370×824）、背景 rgba(0,0,0,.25)、backdrop-filter blur(50px)、radius 30px、padding 10px、z 210。開くとbodyは overflow hidden。開いている間ラベルはCLOSE。カテゴリリンク：24px/700/lh 24px/大文字、白、左30px、行ピッチ約25px。下段の小リンク（SHOPS / ADVICE …）：16px、行内 gap 約12px。CART：白地黒文字、padding 15px、64×41。下端のキャンペーンカード：330×80、黒地、radius 12px、「VIEW」付き、横に並ぶ | パネルの構造（ぼかし＋丸角＋太字の大文字リスト）をそのまま使い、リスト項目をZAOのカテゴリ（SKI / SNOWBOARD / WEAR などTD原案のうち実在ページのみ）に置き換える。小リンクは店舗（Mountain Station / Central Station）・FAQ・法定ページ | CARTボタンは削除。開閉アニメーションの値は未取得（下記「動き」） |
| 企画選択（PC） | 左の縦中央に企画名を縦ホイール状に並べ、中央の1件だけ不透明、上下に離れるほど薄くなる。自動で回る | 01、`ul.absolute.top-1/2.left-4.5` > `li.absolute.origin-left` | 左端 x 28（left 18px＋余白）、縦中央。項目：button、24px/700/lh 24px、大文字、テキスト幅 153〜236。不透明度（中央→外側）：1 → .4705 → .1715 → .0370 → 0。Y方向オフセット（中央基準）：-8 / ±27.5 / ±48.9 / ±65 / ±76.6px 相当。文字色は企画ごとに変わる（観測値：rgb(203,76,58)、rgb(201,38,28)） | 企画名をZAOの既決項目に置き換える（候補：WINTER 26/27、Regular / Premium、店舗2拠点。どれを載せるかは既決内容から決める） | 文字色は企画ごとに決める（承認写真に合わせる）。自動回転の周期は未取得 |
| 企画選択（モバイル） | 下端左に企画名1件。左右へのスライドで切り替わる | 04、下端の span | 24px/700/lh 24px、y 791、x 20（隣の項目は -240 / 280 に待機）。文字色 rgb(203,76,58)（観測時）。前後ボタンは1×1のアクセシブル要素（`<` `>`、x 19 y 803） | PCと同じ企画名 | 同上 |
| 主画像 | 画面いっぱいの写真。PCは四辺10pxの余白を残して角丸16pxでクリップ、モバイルは全面（余白なし） | 01/04、`div.relative.h-full.w-full.clip-rounded.md:rounded-2xl` | PC：外枠 padding 10px、画像 1420×880、radius 16px、overflow hidden。モバイル：h-dvh、padding 0。画像は `<picture>` + datocms の srcset（400w/800w…、fit=crop、w=1600）、object-cover。企画が変わると画像が opacity .25s cubic-bezier(.4,0,.2,1) で切り替わる | 承認済みのSalomon写真（P85 §5の3枚。実ファイルは**未取得**）。トリミングはPC/モバイルそれぞれ記録 | 写真は蔵王の実景・在庫モデルとして表示しない。顔・用品・ロゴがモバイルで切れないトリミングにする |
| タイトル | 独立した見出しはない。企画名（企画選択）がタイトルを兼ねる | 01/04 | 企画選択と同じ（24px/700） | 企画名がタイトルを兼ねる構造をそのまま使う | 新しい見出しや宣伝コピーは追加しない |
| 主要リンク | 右側の縦中央（PC）／右下（モバイル）に、企画ごとに色が変わる矩形ボタン「VIEW SHOP / VIEW RANGE / VIEW LOOKBOOK」 | 01/04、`a > span.group/button` | PC：x 1277、y 429、135×41。モバイル：右端20px、y 783、101×41。padding 15px、16px/400、radius 0。背景・文字色はCSS変数 `--color-button-bg` / `--color-button-text`（観測値：#CA9A73に白、薄紫に黒） | ラベルはTD原案のBOOK RENTAL等。押した先は既存の予約導線 | 支払いを確定するボタンは「GO」の一語にしない（P85 §4） |
| フッター | 主画像の下にある白地の6列のリンク群と、右端の回転ロゴ | 02/06、`footer` | footer：padding 80px 0 20px、高さ376（PC）。外側 flex padding 0 20px、gap 80px。グリッド：PC 6列（各約217px）、gap 40px 20px、幅1400。モバイル 2列（165px×2）、幅350。見出し h6：10px/700、大文字。リンク：16px/700/lh 16px、大文字、黒、縦 gap 10px。著作権表記：10px。右端のロゴ：canvas 160×137。メール登録欄（EMAIL / AGREE / GET UPDATES）がある | 列をZAOの既決内容に置き換える：店舗（Mountain Station / Central Station、住所）、ご案内（料金・FAQ・キャンセル）、法定4文書（承認済み）、運営者（株式会社Yuge） | メール登録欄は設けない（既決にない）。SNS列は実在アカウントがある場合だけ。右端の回転ロゴは静止の受領ロゴ（3.png 縦組）にする |
| 文字組み | 1書体（Neue Helvetica W01）。本文16/24、強調24/24の太字大文字、小見出し10px太字大文字。字間はすべて normal | 全画面、computed style、`document.fonts` | font-family：`"Neue Helvetica W01","Helvetica Neue",Helvetica,Arial,ui-sans-serif,sans-serif`。読み込まれていたWebフォント：Neue Helvetica W01 の 500 と 700（normal）。使われていたサイズ：10 / 12 / 16 / 24px。行送り：10 / 12 / 16 / 24px。実際に描画されたフォントは**未取得**（CDP不可） | 使用許諾のあるフォントで同じ役割（16/24、24/24太字、10px太字）を組む。和文は別途 | Neue Helvetica W01 は使わない（ライセンスが確認できない）。代わりの書体と字幅の差は採寸してから記録する |
| 余白 | 外枠10px、ヘッダー上20px、左右の基本ガター20px（フッター）、メニュー左30px | 01/02/05 | `--header-padding:20px`、`--header-height:60px`。主画像の外枠 10px（PC）／0（モバイル）。フッター 80 / 20 / 20px、列 gap 20px、行 gap 40px、ブロック gap 80px。企画リスト left 18px | 同じ値を使う | なし |
| 色 | 黒・白が基本。アクセント（企画名・主要ボタン）は企画ごとにCSS変数で変わる | 01/04/05 | #000（ピル・ボタン）、#fff（ピル文字・CART地）、パネル rgba(0,0,0,.25)。企画色の観測値：rgb(203,76,58)、rgb(201,38,28)、#CA9A73、薄紫（値は未取得）。ページ背景は透過（body・htmlとも rgba(0,0,0,0)） | 黒白を基本に、企画色は承認写真から1色ずつ決めてCSS変数で切り替える | 本案件の品質基準として通常文字のコントラスト4.5:1以上を守る（Palaceの実測とは別基準） |
| 形 | 丸はヘッダーのピル（完全な丸）・主画像（16px）・メニューパネル（30px）・メニュー内カード（12px）だけ。ボタンは角丸0 | 01/04/05 | 上記のradius値。影はない（観測した要素はすべてbox-shadowなし。PCのbox-shadowは個別に採取していないため、厳密には未取得） | 同じ形を使う | 参照にないカード・pill・グラデーション・影は足さない |
| アイコン | 汎用アイコンはほぼない。可視SVGは0、非表示のSVG（viewBox 0 0 24 24）が1件。前後は文字の `<` `>` | 01/02、`svg` 一覧 | 可視SVG 0件。非表示SVG 1件（viewBox 0 0 24 24、用途は未取得） | 文字ラベルで代える。必要なときだけ参照と同じ線の太さのSVGを作る | 汎用アイコンパックは混ぜない |
| 動き | 3Dロゴ（canvas）、企画ホイールの自動回転とフェード、画像のクロスフェード、hoverの色変化 | 01/05、computed transition | 画像：opacity .25s cubic-bezier(.4,0,.2,1)。リンクhover：color / background-color .15s cubic-bezier(.4,0,.2,1)。企画ホイールの周期・イージング：**未取得**。メニュー開閉のduration：**未取得**（transition は all／値不明）。reduced-motion時の挙動：**未取得** | 画像のクロスフェード（.25s）とhover（.15s）は同じ値を使う。企画ホイールは周期を測ってから決める | 3Dロゴは使わない。reduced-motionのときは自動回転を止める |


## 追加実測（2026-10-10 01:55〜02:05Z、同条件 1440×900／390×844）

- **配信CSS**：`https://cdn.shopify.com/oxygen-v2/28323/14370/29622/4693343/assets/app-BOnBXwsi.css`（70,080 B、sha256 `d58d87c10b605d0fbfe40deea8e3661b0c6da9e807ecd818a00372ce5d4c4ce5`。参照用にローカル `ref/` に保存、製品repoには入れない）。CSSOMからは SecurityError（cross-origin）で読めないため、CSSファイルを直接読んだ。
- **@font-face**：`Neue Helvetica W01` 500/normal・700/normal（woff2、font-display:swap）、`Helvetica Neue LT Std Condensed` 500/normal・500/italic。keyframes は `spin` の1件のみ。CSS内に `prefers-reduced-motion` の記述はない。
- **文字幅で突き合わせた実使用フェイス**（canvas measureText と DOM実測の比較）：
  - ナビ「WEB SHOP」の文字部分 67px（リンク幅 87 − padding 20）＝ `700 16px "Neue Helvetica W01"` の 66.99px と一致。
  - 企画名「PALACE SINGAPORE」236px枠内の文字 = `700 24px W01` 189.36px と一致（Helvetica Bold 24px は 247.59px）。
  - W01 700 は Helvetica Bold の約 0.765 倍の幅＝**コンデンス系の太字**。W01 500 は Helvetica 400 とほぼ同じ幅（160.03 / 161.79、"HAMBURGEFONSTIV" 16px）。
  - `Helvetica Neue LT Std Condensed` はトップでは使われていない（computed font-family に出現なし、読込状態 loading/unloaded）。
  - 実グリフの描画フォント（CDP getPlatformFontsForNode）は引き続き未取得。上記は幅一致による推定根拠。
- **企画ホイールの周期**：PC 1440で25秒間観測、切替時刻 7256 / 12256 / 17256 / 22256 ms → **5000ms間隔**（初回は読込後約7.3秒）。項目の順序：PALACE SINGAPORE → WINTER 2026 RANGE → WINTER 2026 LOOKBOOK → PALACE EBBETS → 先頭へ。
- **メニュー開閉の時間**：未取得。JS（rAF）駆動のため、ブラウザペインが非表示の間は進まなかった（開いた直後の値 opacity 0・高さ20pxのまま停止）。

### 置換方針への反映
- 書体：Neue Helvetica W01 は使わない。ナビ・企画名・カテゴリ見出しには、W01 700 と同じく「Helvetica Bold の約0.765倍の幅」になる、ライセンス上配信できるコンデンス系太字を選ぶ。本文（W01 500 相当）は Helvetica 400 と同じ幅の書体にする。採用候補は実装時に同じ測定文字列で幅を測り、差が2%以内のものを選ぶ。
- 企画ホイール：5000ms間隔で自動切替。reduced-motion のときは自動切替を止める（本案件の基準）。

## 未取得一覧（次回の採取対象）

- 等倍PNG（1440×900・390×844）。今回はツールが縮小したJPEGのみ。
- 実際に描画されたフォント（CDP `CSS.getPlatformFontsForNode`）。@font-face・keyframes・配信CSSは取得済み（上記）
- 企画ホイールのイージング（周期5000msは取得済み）、メニュー開閉のduration、reduced-motion時の挙動
- hover / keyboard focus の各状態の画面
- 1280×800・768×1024・375×812 の画面
- 地域の判定（shop側のリダイレクト先）
- Salomon写真3枚の実ファイル（MIME・実寸・sha256）
- 薄紫のボタン色の正確な値

## 次の工程

この表の根拠が揃ってから、HTML/CSSで同じ骨格を作る。差し替えるのは、受領ロゴ（2/3/4.png）・承認済み写真・既決内容（店舗名・料金・法定文書・運営者情報・TD原案コピー）だけ。参照にない装飾や宣伝コピーは先に足さない。UI実装は、PR #57が受理された後、UIだけを扱う1本のPRで行う。

### 代替書体の実測選定（2026-10-10 02:0xZ）
Google Fonts（OFL）の候補を同じ測定文字列（PALACE SINGAPORE / HAMBURGEFONSTIV / WEB SHOP）で測り、Palace実測幅との差を出した（canvas measureText）。

| 書体 | 700/24px の幅差（3語） | 500/16px の幅差（3語） |
|---|---|---|
| **Barlow Semi Condensed** | **+1.1 / +0.4 / 0.0 %** | −21.6 / −22.2 / −22.6 % |
| Roboto Condensed | +4.8 / +6.0 / +4.1 % | −17.6 / −17.0 / −18.9 % |
| Archivo Narrow | +7.2 / +6.3 / +6.6 % | −16.3 / −16.8 / −17.2 % |
| IBM Plex Sans Condensed | +12.1 / +12.8 / +12.1 % | −13.7 / −12.9 / −14.6 % |
| Barlow Condensed | −12.6 / −12.9 / −12.6 % | −33.4 / −33.8 / −33.7 % |
| Inter Tight | +20.8 / +24.1 / +22.0 % | −7.7 / −5.4 / −7.4 % |
| Helvetica（システム、700/400） | +30.8 / +29.6 / +30.0 % | +1.3 / +1.1 / +0.7 % |

決定：太字の役割（ナビ・企画名・カテゴリ・フッターのリンク）は **Barlow Semi Condensed 700**（差 ≤1.1%、基準 2%以内）を自前で配信する。500 の役割（ボタン文字など）は、システムの Helvetica / Arial（差 ≤1.3%）を使う。和文はシステムの日本語ゴシックで、ここでは測定していない。
