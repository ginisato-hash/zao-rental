# ZAO Rental
# 顧客向け予約UX・商品コンテンツ／写真管理 実装仕様書

Version 1.0｜調査日 2026-09-12｜研究事例124件
Status: DESIGN_READY / IMPLEMENTATION_NOT_AUTHORIZED / PUBLICATION_GATED

本書は既存事業仕様と124件の一次資料研究を接続した設計案。現在のrepo・本番設定には変更していない。

## 01｜結論と文書の使い方

### 推奨する完成形
顧客向けは「日程・店舗をそろえたプラン比較 → 全員の用品選択 → 総額確認 → 決済」。管理者向けは「表で説明を直す／写真をまとめて入れる → 差分確認 → 下書き → まとめて公開」。見た目だけを先に作らず、同じ商品・写真・料金の版を両画面で扱う。

採用案は既存Next.js＋PostgreSQLに、独立した商品コンテンツ・メディア管理モジュールを加える構成。期間在庫・HOLD・料金計算は既存サービスを再利用する。Squareは決済に使用し、商品説明の正本や期間在庫の正本にはしない。[R02–R04 / C033,C045,C054,C114]

### 仕様の位置付け
本書は調査を終えた実装用設計案 v1.0であり、実装・本番公開の承認ではない。既存確定事項を「確定」、今回の設計判断を「提案」、外部接続・営業条件の確認待ちを「公開ゲート」として区別する。未決事項には既定の拒否動作があるため、実装者が想像で補完する必要はない。

P0は初回公開に必要、P1は初期運用改善、P2は後段。P0実装が完了しても、決済・税・在庫・権利・実端末の公開ゲートが通るまで販売を開始しない。

### 成果物の読み順
まず本書で顧客体験と境界を把握し、実装時に別冊API契約・論理データモデル・受入テスト・CSVテンプレートを使う。124事例の個別観測、出典、採用案、採用しない点は調査台帳を参照する。ケースID Cxxxは台帳の行へ対応し、Nxxは規範資料、Rxxは固定SHAの既存コードである。

現在のA〜G安定化作業には変更・割込みを行っていない。将来の実装開始時に最新mainと未解決事項を再照合する。

## 02｜調査方法と124事例の範囲

### 件数の定義
124の異なるURLを根拠に、124件の画面・機能・運用パターンを整理した。同一ブランドの別機能は別事例に数えるが、同一URLの言語違い・同じ機能の言い換えで水増ししていない。提供者表記は52、INTERSPORT各国とContentful連携をまとめた集約ブランド等は48。100社の実店舗で購入した調査ではない。

レンタル事業者31、レンタル管理SaaS15、商品・一括更新22、CMS14、メディア基盤17、一般EC/UI10、一次UX調査15の計124件。日付は2026-09-12。提供者の公式公開ページ・公式ヘルプと、Baymardの公開一次調査を使う。

### 観測と提案の分離
調査台帳の「観測」は資料にある機能・表示。「ZAO採用案」は今回の設計上の推論。「避ける点」は条件差・副作用。競合の転換率・売上増の宣伝数値を、ZAOでの効果予測に転用しない。

管理画面へのログイン、実注文、実決済、実店舗の操作時間計測は行っていない。一部は公式検索抜粋での確認を含む。見た目の画素レベルの忠実な比較、全機能のエンドツーエンド実行検証ではない。公開資料から、各店舗が同じ実装方式を使うとは推定しない。

### 重点的な採用根拠
SPICY・YamaSport・Rhythmはプラン説明と日数料金。Booqable・TWICEはレンタルの公開商品と物理在庫の分離。Shopify・Akeneoは一括編集と画像紐付け。Payload・Sanity・Contentfulは下書き、画像参照、リリース。Baymardはゲスト導線、入力負荷、写真の発見性を参考にする。[C004,C005,C018,C031–C045,C053,C065–C086,C087–C101,C121–C124]

過去に指定されたsalomonstation-zao.com/lpは、今回取得できた本文が不十分なため124件に含めていない。既存承認価格は競合ページから再作成せず、リポジトリ正本を使う。

## 03｜事例から採用する10の判断

| 判断 | 採用する方法 | 採用しない方法／根拠 |
|---|---|---|
| 総額を先に示す | 選択期間・人数の総額を第一表示 | 最安の日平均だけを大きく表示しない [C005,C037,C102] |
| 比較条件をそろえる | 同じ日程・内訳でRegular/Premium差額 | 異なる日数や単品とセットを比較しない [C018,C100,C103] |
| 写真で内容を伝える | 全体・使用場面・詳細・店頭の4役割 | 風景だけ、又は特定モデル保証を暗示する写真 [C034,C094,C098] |
| 迷う前に情報を出す | 含む物・含まない物・モデル扱いをCTA近くへ | 規約末尾だけに重要条件 [C014,C022,C023] |
| 会員登録を省く | 顧客はゲスト予約 | スタッフログインの使い回し [C089,C091] |
| 人ごとの入力負荷を減らす | 共通日程＋利用者カード・競技別項目 | スノボにも体重等を一律要求 [C029,C087,C090] |
| 編集と公開を分ける | 自動保存は下書き、公開は明示 | autosave即本番反映 [C065,C066,C079] |
| 一括処理は差分で判断 | 件数・対象・変更前後・エラーを確認 | 空欄の意味不明、曖昧画像の自動割当 [C035,C053,C121,C122] |
| 写真を再利用する | 原本1つ＋掲載位置別binding | 同一画像を商品ごとに複製 [C072,C111] |
| 一緒に公開する | 参照・翻訳・画像をreleaseで検証 | 正常な1行だけ黙って本番化 [C073,C079,C080] |

これらは効果が証明されたZAOの勝ちパターンではない。公開前の利用者試験と運用試験で、理解率・所要時間・誤操作を測って採否を確かめる。売上を煽るための偽レビュー・偽残数・根拠のない人気順は採用しない。

## 04｜既存システムとの接続と不変条件

### 固定した確認基点
repo ginisato-hash/zao-rental、PR #9。確認headは8467d11a53f74a7028c9a5d92ef2d3b00600c598、base/mainは7caf8cea4af29bb0d07ed3a55838257d8a9ffe5c。これは調査時点の固定基点で、後続実装のmerge許可ではない。[R01]

LedgerRecordにはmodel/variant/Asset/pole/bundleと店舗・状態・履歴があるが、公開用説明、locale、画像権利、コンテンツreleaseの契約ではない。QuoteServiceはStaffPrincipalと所有HOLDを検査し、PRIVATE_AVAILABLEの料金版を使う。匿名ルートへそのまま開放してはいけない。[R02,R03]

### 維持する確定条件
2店舗、08:30–17:00、AM返却12:00、PM貸出13:00、半日〜10日。前日受取なし、同日AM→PM再貸出なし。異店舗返却可、通常17:00便、10分での自動受領なし。

板・両種ブーツは1組＝1 Asset、左右同一ID、片側1スキャンで1組。ポールはサイズ別ペア数量。約300セット・ウェア約200着は計画値で、個体明細やウェア販売仕様の完成を意味しない。

13歳以上大人、年齢区分横断の在庫代替なし。基準長は身長−20cm、元の基準から±15cm、ブーツ初期候補は申告足サイズ＋1cm。安全設定・DIN・BSLを推測しない。写真や説明もこの制約を上書きしない。

### 未公開の理由を維持する
料金は既存18商品×AM/PM・1〜10日の216明示値。税込/税抜の正本前提、営業・販売期間、本番TTL、実クーポン規約などが未確定。現calculateは税表示未確認、chargeReady=falseである。[R04]

本書のCMS編集で価格・在庫数・商品区分・許容サイズ・キャンセル条件を直接変更させない。公開ゲートを満たすまでは非公開previewだけを許可する。

## 05｜顧客向けサイトの構成［UX-01］

### URLと入口
| 画面 | 主目的 | 主な入力・表示 |
|---|---|---|
| /{locale} | 興味から日程検索へ | ブランド体験写真、予約検索、プラン、店舗、安心情報 |
| /{locale}/rental | 条件をそろえて比較 | 受取/返却店舗、期間、人数・年齢区分、競技 |
| /{locale}/rental/{slug} | 商品の理解と選択 | 写真、内訳、用途、選択期間総額、プラン差 |
| /{locale}/prices | 日数別料金を確認 | AM/PM、1〜10日の明示料金、比較条件、税表示 |
| /{locale}/book | グループ入力と見積 | 利用者カード、サイズ、連絡先、合計、最終確認 |
| /{locale}/booking/{opaque} | 支払い状態・受取案内 | 認可付き結果、QR、持ち物、店舗、変更案内 |
| /{locale}/stores/{store} | 店舗を間違えず来店 | 実写真、地図、営業時間、受取返却、経路 |

日程検索から入っても商品写真から入っても、同じbooking contextへ合流する。商品詳細を見るために日時入力を強制しない。日程未選択では「日程を選んで料金・空きを確認」。販売可能期間の最安値を示す場合も、日数・年齢・プランと未在庫確認を併記する。

### トップページの順序
1. ZAOの実景＋「道具選びを済ませて、雪山へ。」という提案コピー。日程・店舗の主CTAを同じ画面に置く。
2. スキー／スノーボードと、Regular／Premiumの短い比較。
3. 料金とセット内訳。事前5%割引は条件と実計算が一致する時だけ掲載。
4. 入力→事前決済→店舗で試着・受取という流れ。待ち時間ゼロとは約束しない。
5. 実店舗・スタッフ・整備風景、アクセス、よくある質問。
6. 再度日程CTA。規約・プライバシー・運営者情報をfooterへ。

長いブランドストーリーを予約入口の前に置かない。2店舗を地名だけで選ばせず、地図・目印・住所・来店経路を添える。店舗写真と説明はADMINが更新可能にする。[C001,C003,C016,C024,C106,C109]

## 06｜商品写真とプラン比較［UX-02／03／04］

### 商品カードの必須内容
写真、公開商品名、競技・年齢・クラス、用途の一文、含まれる用品、選択期間総額、料金差、モデルの扱い、在庫確認の状態、CTAを持つ。読み始めに300個体を並べず、販売offerをまとめる。利用者カードは同じofferを複数人へ選べる。

Regularは「必要な道具をそろえて楽しむ」、Premiumは「選定基準・機能・サービス上の具体的な違い」を説明する。具体的な差が確認できない間は「上級者向け」「高性能」等を自動生成しない。価格が高いことだけをおすすめ根拠にしない。[C018,C097,C100]

### 商品詳細の順序
写真gallery → 商品名/用途 → 日程・合計/CTA → Regularとの違い → セット内訳 → サイズ選びと店頭確認 → 受取店舗 → 変更・キャンセル → FAQ。PCは写真左/料金とCTA右、モバイルは写真→料金→要点とする。詳細説明は展開可能だが、追加料金・モデル非確約・キャンセルは折畳みの奥だけに置かない。

### 写真の4役割と原稿
| role | 撮影内容 | 表示規則 |
|---|---|---|
| COVER | 板・ブーツ・ポール等の全セット | 用具を欠けさせない。税込総額と別料金品の誤認を防ぐ |
| LIFESTYLE | 実際の滑走・使用場面 | 写るウェア等が別売ならcaption。人物の権利確認 |
| DETAIL | 板/ブーツ等の特長 | 差を説明できる詳細。実際の取扱範囲から逸脱しない |
| SERVICE | 実店舗の試着・準備 | 受取体験への不安を減らす。過剰な待ち時間保証なし |

代表モデルしか約束しない場合、写真近くに「写真は取扱例です。モデル・色柄は指定できません」。ギャラリー全体で同じルールを守る。model guaranteeはofferの明示契約が承認された場合だけ有効にする。

thumbnail・枚数・拡大・前後・閉じるを表示し、キーボードでも操作する。ヒーローの自動動画・重い回転3D・偽レビューはMVPに入れない。[C034,C046,C062,C063,C088,C092,C094,C098,C099]

## 07｜日数・プラン・割引の価格表示［PRICE-01〜03］

### 第一表示は「今回払う総額」
「大人1名／スキーセット／2日間／Mountain受取」の条件見出しの直下に、期間総額を最も強く表示する。グループでは利用者別明細と全員合計を区別。税込表示は税前提の承認後のみ。未承認時に税を勝手に足す/税込と呼ぶのは禁止。[N01]

未選択の日数に最安の日平均だけを当てて「¥○○〜」としない。日平均はDAY_nの期間総額÷nを補助表示する場合だけ。「1日あたり換算／請求は総額」と明記し、半日を0.5日で割らない。丸めと割引順は価格エンジンを使用する。

### 日数とカレンダー日付は別軸
AM/PM/DAY_1〜DAY_10の明示表を使う。日付選択では週末・祝日などの独自加算を作らない。将来日付別価格を導入する時は別の承認済み料金規則と、その選択期間への適用内訳が必要。

料金表は初期「半日・1・2・3日＋他の日数」で表示し、全12区分へ展開できる。選択した日数列を強調し、スマホで横移動が必要な場合は固定見出しとスクロール案内を付ける。商品カードの選択を変えても日程・人数を捨てない。[C004,C005,C020,C025,C037]

### プラン差額と長期のお得感
同じ競技・年齢・人数・期間・セット条件のRegularとPremiumだけを比較し「今回の期間では＋Δ円」。異なる条件の最安値を混ぜない。売切れのプランに料金だけ出して選べるように見せない。

日数割のお得感は「1日料金×n日と比べた差」のように比較根拠を明示できる場合だけ表示する。実際に売った過去価格という意味の取消線・通常価格は別証拠が必要。根拠がない「最大○%OFF」「地域最安」「残り1点」は禁止。[N03 / C015,C038,C102]

### 早割・クーポン
5%早割の最終資格は前日15:00 JSTまでの決済完了。見積段階は適用見込み。期限をまたぐ場合は支払い前に再提示し、黙って高い金額で請求しない。クーポン欄は折畳み可、明示適用と失敗理由を表示。入力照会で利用回数を消費しない。併用未設定は許可しない。[R04]

## 08｜グループ予約のUIと保存［UX-05／06］

### フローを6つの状態として設計する
| 状態 | 顧客の操作 | システムの約束 |
|---|---|---|
| CONTEXT | 期間・店舗・人数/年齢区分 | 条件を保存。まだ在庫確保しない |
| PLAN | 人ごとの競技・プラン | 同条件の参考総額。group成立は未保証 |
| PROFILE | 必要な身体情報・サイズ選択 | 実在候補を提示。選択を勝手に変えない |
| REVIEW | 代表者連絡先・全員明細・規約 | 金額、内訳、期限と変更箇所を確認 |
| HOLD_PAYMENT | 「空きを確保して支払いへ」 | 全員all-or-nothing、成功後だけ600秒HOLDを表示 |
| RESULT | 処理中/成功/再確認 | サーバーの予約・決済確認後だけ予約完了 |

画面数は利用者試験で調整できるが、これらの状態を混ぜない。長いプロフィール入力の最初から10分を消費しない。確認画面以前に必要入力を済ませ、HOLD開始を最後の支払い直前へ寄せる。これはTTL延長ではなく、開始タイミングのUI設計である。

### 入力の負担を減らす
共有日程・店舗は1回。利用者ごとに「利用者1」「子供1」等の短いカードと完了状態。前の利用者から競技・プランだけコピーでき、身長・足サイズ・年齢等は自動コピーしない。名前等の法令/契約上必要項目は承認された範囲のみ。

スキーは必要な身長・足サイズ・年齢・体重・レベル。ボードは身長・足サイズと13歳以上かを基本にし、詳細年齢・体重・レベルを必須にしない。競技変更時に不要項目を出し続けない。数値入力には単位を固定表示し、変換した値と許容範囲をサーバーで検証する。

### 回復できるUI
保存済み/保存中/未保存を区別する。入力を戻る操作やエラーで消さない。遅い応答はrequest versionで破棄し、別人の候補へ反映しない。自動保存はサーバーのguest contextへ最小限、公開URLや分析イベントへ身体情報を入れない。

グループで1用品不足なら全体を確保しない。影響する利用者・用品を示し、他の入力は保持。元の有効HOLDの変更失敗時は元を残す。期限切れ後にカウントを巻き戻さず、新しい確保には再評価・明示操作を求める。[C087,C089,C090,C093,C095 / R02–R04]

## 09｜最終確認・決済・受取案内［UX-07／08］

### 最終確認画面
利用者と用品の数量、期間/受取・返却予定店舗、税込の支払総額と内訳、支払方法・時期、提供時期、変更/キャンセル条件、申込期間がある場合の期限をまとめる。修正リンクは該当箇所へ戻り、入力を保持する。最終ボタンは有償申込みと分かる日本語・英語にし、単なる「次へ」で請求させない。[N02]

前日50%・当日100%、期限前返却原則返金なし等は承認済み規約と同じ版を表示する。法的適用・免責範囲は公開前に事業者確認を行う。悪天候や怪我への例外返金は内部の権限付き監査処理であり、「例外返金できる裏口」を顧客や開発用公開APIへ作らない。

### Squareとの境界
Web Payments SDKが生成するtokenをサーバーへ渡し、サーバーが価格・HOLD・idempotencyを確認してPayments APIへ接続する。ブラウザの成功画面だけで予約完了にしない。カード番号等をアプリDB・ログ・分析へ保存しない。対応walletは日本のmerchant設定・SDKの実確認後だけ表示。[N11]

リクエスト応答不明は「お支払い状況を確認しています」。同じ決済attemptを照合し、無条件に再請求しない。期限後の決済成功は在庫再確認・例外処理へ回し、二重販売せず、返金もこの画面が勝手に確定しない。決済/HOLD既存契約を独立した後続実装で閉じる。

### 完了後
サーバーが支払い・予約確定を確認した場合だけ、予約QR、利用者別用品、受取店舗の写真/地図/営業時間、来店時の試着と確認、返却期限、連絡窓口を表示する。QRには不変の予約参照又はopaque tokenを用い、顧客情報を平文で埋め込まない。メール再送も連打で多重送信しない。

ユーザーが迷わない文例：「予約が確定しました。ご来店後にブーツの試着と最終調整を行います」。事前予約を理由に「スタッフ確認不要」「必ず待ち時間なし」と表現しない。[C002,C019,C022–C024,C108]

## 10｜UI仕様・多言語・計測

### デザインの提案値
雪景色の白、読みやすい濃色文字、重要操作1色を基本とする。特定ブランドの商標色やロゴは使用権確認後。本文16px以上、説明は短文、最大本文幅720px程度。主要タップ領域は48pxを設計目標、AA最小24pxに関する条件は別に確認する。価格だけ大きくし、注記を極小にしない。[N04]

スマホは1列のカード、下部固定バーに期間・合計・次へ。キーボードや画面拡大で入力やエラーを覆わない。PCは比較2列と予約summary。並替えにはdrag以外に「上へ/下へ」も用意する。色だけで在庫・エラーを伝えない。

### locale設計
初期案はja/en。言語追加は営業承認。日時は業務上Asia/Tokyo、期間内訳は両言語で同じ。円額はJPY固定。翻訳は元原稿revisionを参照し、重要条件の翻訳未確認・古い翻訳が残れば当該localeを公開しない。英語画面に日本語の規約だけを隠れて差すfallbackは禁止。写真原本は共用し、caption/altを掲載箇所・locale別に持つ。[C060,C084]

### 仮説と測り方
最優先仮説は、期間総額が分かるほど価格誤認が減る、プラン差を用途で説明すると比較しやすい、代表者が迷わずグループ入力できる、写真一括割当が編集時間を減らす、の4つ。今回の調査は売上効果を測定していない。

記録するeventはview_offer、compare_plan、context_change、profile_complete、hold_request/result、quote_refresh、payment_attempt/result、booking_confirmed。content release、price version、匿名context IDを持ち、氏名・メール・身体情報・クーポン生コードを分析へ送らない。

公開前に初心者/家族代表/経験者/海外客を含む8〜12名程度のタスク試験を提案する。これは探索的な操作試験で統計的なCVR改善証明ではない。小規模公開で離脱点を見て、十分な母数があるときだけA/B試験を計画する。主指標は確定予約率、補助は入力やり直し・在庫不成立・問い合わせ率。客単価上昇だけで成功としない。

## 11｜ADMIN管理画面の全体［CMS-01／02］

### 管理画面の入口
既存スタッフログイン内に「商品・コンテンツ」を追加する。初期はADMINかつ明示Permissionのある者だけ。公開商品全体の編集はALL店舗scope。店舗紹介だけを店長へ委任する場合は別の限定scopeで設計し、一般STAFFに自動付与しない。

| 画面 | 日常業務 | 重要表示 |
|---|---|---|
| 商品一覧 | 絞込み・表編集・一括操作 | 写真、code、競技、年齢、クラス、公開状態、翻訳・権利の不足 |
| 商品編集 | 説明・benefit・写真・SEO | 公開中との差、版、保存時刻、PC/スマホpreview |
| 写真ライブラリ | upload・検索・一括metadata | 利用先、用途、権利、解像度、処理状態 |
| 一括更新 | CSV/表/画像manifest | 固定対象件数、KEEP/SET/CLEAR、変更前後、エラー |
| 公開release | 全体preview・公開・復元 | 対象offer/locale/共通block/画像、公開ゲート |
| ジョブ履歴 | 中断・失敗・再試行 | 成功/未処理/競合、操作者、元データのhash |

一覧の「選択した12件」と「現在のフィルターに一致する18件」は別操作。後者は選択時点のID集合を固定する。画面を移動しても「何に何をするか」が失われない。[C035,C053,C081,C121]

### 商品編集の項目
公開名80文字、短い説明160文字、benefit最大3件各60文字、構造化本文最大8ブロック、注意点、FAQ参照、画像gallery、locale、SEOtitle/description、slug、掲載順を基本にする。値は設計上の初期上限で、JSONとUTF-8の有限body上限も導出する。

セット内訳・年齢区分・クラス・モデル保証・料金条件は商用契約から読み出す。編集者の説明と矛盾する場合は検証エラー。商品code/価格key/variant mapping/在庫数を説明CSVから変更させない。自由HTML・script・style・iframeは非対応。[C041,C052,C057,C061]

## 12｜下書き・承認・公開・復元［CMS-03〜06］

### 保存と公開を切り離す
編集は下書きへ自動保存。画面には「下書き保存済み 14:32」「公開中は旧版」と表示。通信断・競合時は成功表示しない。保存ごとに新しい不変content revisionを作り、draft pointerをexpected revisionで比較更新する。

状態はDRAFT / REVIEW_READY / PUBLISHED_RELEASE_REFERENCE / ARCHIVED。単品のPUBLISHEDフラグをばらばらに更新せず、公開単位はrelease manifestとする。下書き本文、内部メモ、upload原本、dry-run reportを匿名APIへ返さない。[C065,C066,C070,C075,C078]

### releaseの手順
下書き選択 → 参照差分 → locale/画像/権利/商用条件の検証 → 全体preview → 明示公開。検証結果は対象revision集合のhashを持つ。検証後に別編集者が変更したら再検証。公開にはexpected current releaseとplan hashの一致が必要。

公開DB取引でrelease rows、現在pointer、監査、cache invalidationのoutboxを同時保存する。画像加工とstorage uploadは事前に終えておくが、承認前の画像はprivateのまま。公開APIは1つのrelease IDを固定して読み、商品本文だけ新・画像だけ旧という混在を避ける。[C067,C073,C079,C080]

### 一括の失敗と復元
一括の下書き更新はoffer/locale単位で原子的。失敗行があっても成功した下書きは残せるが、PARTIALと明示する。本番公開は選んだreleaseの全件成功か0件。失敗行を勝手に除いて公開しない。

復元は旧releaseを上書きするのではなく、新releaseとして再発行する。画像権利・現在の商用規則・商品販売可否を再検証し、失効権利や古い価格を戻さない。過去予約のsnapshotや確定金額は変更しない。価格版の変更とコンテンツ復元は独立操作。[C076,C079,C086]

予約公開日時はP1。JST表示、実行直前の権限・権利・依存再検証、重複実行防止を備える。MVPでは手動公開でよく、保留中AI Runnerをコンテンツ公開用に流用しない。[C085]

## 13｜一括更新の具体的な操作［BULK-01／02］

### よくある3業務
「全18商品の短い説明を変える」→一覧で対象を絞る→説明列を表示→複数セル貼付又はCSV→差分確認→下書きへ反映。
「全商品で同じ店頭試着の案内を変える」→共通blockの新revision→影響する商品とlocaleを一覧→まとめてrelease。コピー済み文章を18回直さない。
「今季の主画像をまとめて入替える」→写真をdrop→codeによる割当候補→未一致だけ修正→画像処理→release preview。[C031,C047,C048,C053,C057,C110,C122]

### CSVの契約
P0はUTF-8 CSV、既存offerのみ更新。日本語Excel向け書出しにはBOMを付け、RFC4180の引用・改行を扱う。列はschema_version、offer_code、locale、expected_revision、field、operation、value。安定ID照合・許可fieldだけを受理する。

operationはKEEP/SET/CLEAR。KEEPは変更しない、SETはvalueで置換、CLEARは消去可能な任意fieldだけ空にする。空白セルを自動消去と扱わない。必須fieldのCLEAR、未知code、未知field、重複する同一field行、価格/在庫列は検証エラー。

同じoffer/localeの行をまとめて検証・保存し、その単位で全部又は0行。CSVの値から商品を自動新規作成しない。新offer作成は商用mapping確認の別権限付き操作。

### 変更確認と再実行
dry-runは正規化入力、対象ID集合、各expected revision、対象fieldのBefore/After、警告を保存し、plan hashを返す。commit時には同じhashと対象版を再照合。既に成功した再送は同じ結果、同じキーで異なる内容は409。

1000行・CSV5MiB・1job当たり対象200 offer/localeを初期の設計上限とする。現18商品に対して余裕を残しつつ無制限にしない。小さい通常APIのbody上限を、このCSV受付に合わせて一律に広げない。

CSV exportは数式注入を防ぐ。人がExcelで編集する安全CSVと、完全な機械用JSONを分ける。SET値を表計算の数式として実行せず、エスケープのround-tripは明示する。[C055,C113 / N07]

## 14｜写真一括登録と利用先管理［BULK-03／MEDIA-01］

### P0：複数ファイル＋manifest
「写真を200枚選ぶ → サムネイルで確認 → 商品候補へ割当 → 足りない箇所だけ直す」を基本にする。ZIPはP1とし、最初から解凍処理を必須にしない。P0ではdrag&dropと通常ファイル選択の両方を提供する。

任意のファイル名でも受け取るが、自動候補はoffer_code__role__sort.extの完全一致だけ。例：DEMO-SKI-ADULT-REGULAR__COVER__01.jpg。実際のcodeは管理画面から書き出す。部分一致・似た商品名・AI推測は人が確認する候補に留める。

manifest列はschema_version、filename、offer_code、locale、role、sort_order、operation、expected_revision、alt_text、caption、rights_record_id。画像1点を複数商品へ再利用可能。同一ファイル名の異なる内容、同一role/orderの重複、未一致は要確認。caption/altだけをまとめて編集できる。[C047,C059,C083,C110,C112,C116,C122]

### コピー数と権利
同一byte hashの原本は内部で再利用候補にできるが、別の権利情報を勝手に継承しない。画像には撮影者/権利者、許諾範囲、証拠、期限、人物同意の記録を紐付ける。メーカー写真・競合写真をネットから無断取得しない。AI生成画像を現物写真として表示しない。

初期入力はJPEG/PNG/WebP、1枚10MiB・25MPまで、200枚・合計500MiBまでを提案。HEICはiPhone業務の実需を評価しP1の安全な変換機能又は事前変換にする。非対応形式はupload前に説明し、形式だけjpgへ改名させない。

### 一括gallery編集
メイン画像はCOVERを1枚、他roleは順番付きで最大12点。画像入替えは公開中画像を上書きせず新binding revisionを作る。複数画像を選んだとき、異なるalt/権利/用途は「複数の値」と表示。CLEARとKEEPを別にする。画像を商品から外す操作と、原本の削除は分離する。

ライブラリは使用中商品数・公開locale・下書き・過去注文参照を示す。使用中を通常の物理削除で消さず、権利取消等の緊急非公開は別の監査付き操作にする。[C072,C077,C117,C118]

## 15｜バックエンド方式の比較と採用理由

| 方式 | 利点 | 今回の判断 |
|---|---|---|
| 既存Next.js/PGへnative module | 既存認証・HOLD・見積と同じ契約。必要業務に絞れる | 推奨。管理UIと画像処理の維持責任は自社に残る |
| Payload | 下書き・版・upload・管理UIを持つ | 将来候補。既存認証/DB migrationと競合を検証。Local APIの認可省略に注意 |
| Sanity / Contentful | 翻訳・参照・release等の編集体験 | 複数編集者や多言語拡大時の再評価候補。接続・運用費・権限の追加が必要 |
| Directus | 既存DB上の管理と版管理 | 商品専用DB/API境界なら候補。業務DB全体をCMSへ開放しない |
| Square Catalog中心 | POSと商品画像を共有しやすい | 決済/POS向け任意連携。期間在庫・公開CMSの正本にはしない |
| Shopify/WooCommerce中心 | 豊富な商品・注文UI | 今回の期間割当・2店舗移動を置換すると再実装が大きい。全面移行は不採用 |

これは性能や総費用を実測した順位ではなく、既存資産との適合性による設計判断。今回サービスの契約やインストールはしない。価格・無料枠・地域対応は導入時に再確認する。[C031–C086,C110–C124]

### 推奨構成
顧客Next.js → Public Booking BFF → Offer/Contentの公開読み取り＋既存Recommendation/HOLD/Quoteへの安全なguestアダプタ。
管理Next.js → 既存スタッフ認証 → ContentService/MediaService/BulkService/ReleaseService。
PostgreSQL → 業務表とは論理境界を分けたcontent/media/job/outbox表。
Private object storage → 検査/再encode worker → versioned derivatives →公開media gateway/CDN。

Public BFFはStaffPrincipalを偽造しない。匿名利用には推測不能なguest sessionと所有予約contextを用意し、rate limit・CSRF/origin・期限を確認する。Staff ownerチェックを削るだけで公開しない。未解決A〜G安定化の上に、この別のactor契約を実装する。

## 16｜論理データモデル［DATA-01〜04］

### 三つの商品を混同しない
physical model/variant/Assetは現物。offeringは「大人Regularスキーセット」等の販売単位。content revisionは、その販売単位をどう説明・撮影表示するか。画像1枚はAsset在庫ではなくmedia assetであり、命名もequipment_asset_idとmedia_asset_idで区別する。

| 論理表群 | 主なfield・制約 | 役割 |
|---|---|---|
| catalog_offers | id, code UNIQUE, price key, eligibility mapping, commercial revision | 販売単位。CMSから価格・在庫を変更不可 |
| content revisions / draft heads | offer+locale, content JSON/hash, actor, current revision, version | 本文は不変版、draft pointerをCAS更新 |
| shared blocks / media bindings | block revision、media ID、role/order、locale、alt/caption/crop | 共通説明と掲載位置。原本複製を防ぐ |
| media assets / derivatives | private blob key, SHA, dimensions, state、preset/pipeline版 | 原本と用途別の不変派生。組合せ一意 |
| media_rights | owner, grant scope, evidence, valid until, review state | 許諾・使用範囲・取下げ |
| upload_intents | actor, staging key, expected SHA/size, expiry/state | uploadとfinalizeの認可・再送識別 |
| releases / entries / current | manifest hash、offer+locale→revision、current pointer/version | 公開単位。currentをCASで切替 |
| bulk_jobs / items | targets/operation hash, expected revisions, state/result | 対象固定と再開・項目別結果 |
| content_audit / outbox | actor, action, before/after hash, request ID, event state | 監査・cache更新の再実行 |


IDは不変、公開slugはlocale別・重複禁止・変更履歴redirect。JSONにはSchema版があり、無制限HTMLは保存しない。created_atとpublished_atと権利期限は別。個人情報・認証tokenはcontent表に保存しない。

注文成立時はprice snapshotに加え、購入判断に使ったoffer/content/規約revisionと必要な表示情報を固定する。後日の誤字修正で注文の約束を変えない。個人情報の保管・削除期間は別の業務方針で管理し、画像永久保存と混同しない。

## 17｜画像処理・保存・配信［MEDIA-02／03］

### 状態と処理
INITIATED → UPLOADED → QUARANTINED → PROCESSING → READY または REJECTED。READYは画像処理完了であり公開ではない。公開可否はreleaseの参照と権利で判定する。

upload intentを作り短命の署名URLでstagingへ送る。署名URLは期限内再使用可能なので「1回しか使えない」と扱わない。finalize時に所有者、期限、申告/実byte数、独自SHA、実形式を再検証する。ETagを常にMD5と仮定しない。[N08,N10]

元キーへ後から再uploadされても公開済み画像が変わらないよう、検証したbyte列をworkerが別のimmutable処理キーへ取り込み、そのchecksumに派生を結び付ける。stagingキーを公開参照にしない。DB内の確定とobject storageの書込は別の処理で、外部storageまで1取引でrollbackできるとは称さない。

### 内容検査
拡張子/MIME申告だけでは許可しない。画像decoderで実形式・pixel数・圧縮・破損を確認し、向きを正規化、EXIF/GPSを除去、管理されたencodeで出力する。SVG・HTML・script・任意URL importはP0非対応。decoderは更新・制限・隔離が必要。[N06]

### 配信
原本と下書き派生はprivate。公開media gatewayは公開manifestが参照し権利有効な派生だけを配信し、CDNでversioned URLをcacheする。cookie付きdraft previewはno-store。公開前に画像をpublic bucketへ置いてURLだけ隠す方法は不採用。

派生幅320/640/960/1440/1920、WebP＋JPEG fallbackをP0、AVIFは計測して採用。サイズ・width/height・alt・srcset/sizesを返し、LCP画像は遅延読込しない。他の画像はlazy load。COVERはcontain、LIFESTYLE/heroは確認済みcrop/focal point。[C069,C074,C119,C120]

緊急の権利取消では新規配信拒否、参照のunpublish、CDN purgeを実行し結果を記録する。ただし既存のブラウザcacheや既に取得した画像の完全回収は保証しない。参照解除・原本archive・物理削除の3操作を分ける。[C118]

## 18｜認可・ジョブ・トランザクション

### 最小権限
CONTENT_VIEW、CONTENT_EDIT、CONTENT_BULK、CONTENT_PUBLISH、MEDIA_MANAGEを提案する。初期はADMINへの明示付与のみ。PRICE_EDIT、REFUND_OVERRIDE、STAFF_MANAGEは別権限。作成者だから何でも公開できるとはしない。[C068,C071,C123]

同時編集はexpected revisionで409、変更直前の権限失効も反映。S01で修正するA/Bと同じ保証を、bulk commitとreleaseに適用する。通常DBロールへDDLや認証情報のSELECTを広げず、content/media/job表だけに必要権限を付与する。

### bulk/media job
API要求はjobを永続保存し、workerがclaim lease付きで小さなbatchを処理する。jobのactor、権限、対象revisionを実行直前にも確認し、権限取消は未処理分を止める。UIを閉じても状態は残るが、旧actorの失効後に書込を継続しない。

idempotency key＋normalized payload hash＋target snapshotで重複を防ぐ。通信不明はjob照会へ戻る。同じ根本原因を無限再試行しない。変換の一時障害は指数backoff最大3回を提案し、恒久エラーと区別。処理上限やrun予算はAI開発Runnerとは別の業務worker設定。

### 原子性の境界
商品/locale1件の下書き更新はall-or-nothing。複数商品の一括draftは項目別成功を許すが集計はPARTIAL。公開releaseは全件all-or-nothing。画像派生の作成は事前処理。release commit後のcache更新はoutboxで再実行可能とし、公開APIはcurrent releaseを正とする。

共通block更新で使用先が増えていても、dry-run後に対象を黙って増やさない。公開対象はmanifestの固定集合。旧releaseへの復元も現在の認可・権利・商用mappingを検証する。

### 脅威として試験するもの
公開APIの下書き漏れ、IDOR、CSV数式注入、rich text XSS、画像偽装、巨大pixel、署名URL横取り/再利用、同名差替え、他actorのjob再開、権限取消中の公開、cacheからの期限切れ画像、失敗ログの秘密値。ZIP導入時はpath traversal・解凍爆弾・symlinkを追加する。[N06–N10]

## 19｜APIの責務とエラー契約

### 公開側
GET /api/public/catalog と /offers/{slug}は公開済みcontent manifestだけを返す。料金は「表示用の承認済み価格版」と「条件付きquote」を区別し、在庫を確保したと誤表示しない。未承認料金を配信しない。公開静的catalogと動的availability/quoteはcache境界を分ける。

POST /api/public/booking-contexts、/{id}/recommendations、/{id}/holds、/{id}/quotesはguest所有確認付きの将来BFF契約。既存スタッフAPIとは別。顧客がprice_product_key、role、内部Asset ID、合計額を指定してそのまま通せない。

### ADMIN側
POST /api/content/offers/{id}/revisions、POST /api/media/uploads/init・/{id}/finalize、POST /api/content/bulk/validate・/{id}/commit、GET /jobs/{id}、POST /releases/validate・/publish・/{id}/restoreを提案する。endpoint名は既存route規則に合わせて調整可能だが、認可・冪等性・版検査は必須。

レスポンスの基本形はdata又はerror{code,message,fieldErrors,retryable,requestId}。秘密のSQL・token・原本URLは返さない。422は入力、409は競合/再評価、401/403は認証認可、413は容量、503は一時不能。利用者に修正方法を示し、色だけで伝えない。

| code例 | UIの対応 |
|---|---|
| DRAFT_CONFLICT | 別の編集があります。最新内容を読み込み直す |
| BULK_PLAN_STALE | 対象が変わりました。差分を再確認する |
| MEDIA_REJECTED | 形式/容量/解像度等の原因と再登録方法 |
| RIGHTS_UNVERIFIED | 許諾情報を確認するまで公開不可 |
| RELEASE_INVALID | 不足項目と影響する商品・localeを表示 |
| PRICE_REQUOTE_REQUIRED | 新旧条件・金額を提示し再同意 |
| GROUP_STOCK_CHANGED | 影響する人・用品だけ選び直す |
| PAYMENT_CONFIRMATION_PENDING | 同じattemptの確認を継続し、再請求しない |

詳細な入力、応答、冪等性、権限、対象外は別冊API_CONTRACTS.mdとJSON Schemaに記載。これらは契約案で、動作するサーバーを提供したという意味ではない。

## 20｜受入試験と品質目標

### 機能の合格
別冊ACCEPTANCE_TESTS.csv/JSONにテストID・前提・操作・期待・種別を列挙する。単体だけでなく、ADMINの通常画面→API→実DB→公開previewまで一貫させる。公開BFFのguest認可はstaff test principalによる代用で完了にしない。

必須の利用者試験は、日程選択と2プランの差額理解、家族/混在グループ入力、追加料金の理解、通信断からの再開、期限切れの再確認。管理者試験は18商品一括説明更新、50写真の割当、曖昧写真の検出、他管理者の同時編集、下書き一括反映、公開/復元、権限取消中のjob。

### 性能の提案目標
顧客Core Web Vitalsはモバイル/PC別の実利用p75でLCP≤2.5秒、INP≤200ms、CLS≤0.1を目標にする。Lighthouse等のlab結果は実利用達成と同一視しない。[N05]

写真ページ初回はhero1枚だけ先読み、他をlazyにし、カード画像150KB・hero350KB程度を設計予算とする。これは全写真で必ず満たす保証でなく、画質と実端末を測って調整する初期予算。APIは代表シナリオを測定し、p95・エラー・判定不能を別に報告する。

過去E09の高速値は推薦previewのみ。本画面全体、決済、bulk processingの達成値に転用しない。300板＋必要構成品、複数のlive HOLD数、2名/20名、同時数1/4/10、複数期間・店舗移動を変えて測る。画像処理jobが予約APIの接続poolを奪わないことを確認する。

### 運用目標の提案
用意した説明18件のbulk反映を、単品編集18回より少ない操作で完了する。50枚の写真で完全一致は自動候補、未一致だけ修正し、誤割当0を目指す。所要時間は実測前なので保証値を置かず、比較測定する。入力支援のAIを入れるより先に、CSV・表編集・規則的な画像紐付けを完成させる。

## 21｜実装順序・非対象・公開ゲート

### 実装パッケージの提案
| package | 成果物 | 依存 |
|---|---|---|
| PUB-01 契約基盤 | offer mapping、content revision、権限、追加migration | A〜Gの安定化と現head再照合 |
| CMS-01 単品編集 | 説明/locale/画像参照、下書き、差分preview | PUB-01 |
| MEDIA-01 画像基盤 | private upload、検査、派生、権利、利用先 | PUB-01・storage承認 |
| BULK-01 一括運用 | 表/CSV/写真manifest、dry-run、job回復 | CMS-01・MEDIA-01 |
| PUB-02 公開catalog | release、公開一覧/詳細/料金/店舗、権限試験 | 上記・税/権利/価格gate |
| BOOK-01 顧客予約BFF | guest context、グループ入力、HOLD/quote整合 | 安定化済み在庫・見積 |
| PAY-01 決済結合 | Square sandbox、状態照合、完了/QR案内 | 別途E10以降の承認 |
| RELEASE-01 受入 | 実端末・実在庫・スタッフ試験、監視、復旧 | 全公開gate |

既存E番号のタスクを無断で再採番せず、これらを後続担当が対応付ける。並行作業でも同じmigration・lockfile・API契約の所有者を一人に決める。A〜Gの修正branchへ今回の新機能を混ぜない。

### 必須の公開ゲート
税区分/216価格の意味、販売・営業期間と本番HOLD/quote期限、Early割引の最終規約、キャンセル規約と事業者表示、モデル保証範囲、JA/ENの公開可否、写真の利用権、Free helmetの条件、ウェアの販売単位/価格、storage/provider予算、Square本番権限・永続DB/TLS・実スタッフ/端末確認。

不明なものは管理画面に具体的な不足として表示し、該当機能を非公開にする。wearだけ未確定ならwearの公開を止める。税や決済未確定なら全請求を止める。文章・写真の制作と非公開previewは進められる。

### P1/P2へ分けるもの
P1：予約公開、HEIC/ZIP安全対応、画像の追加変換、編集者の権限委任、任意のSquare POS画像同期。P2：顧客アカウント、UGC/レビュー投稿、AI自動コピー/画像生成、個別推薦の高度化、巨大な自由ページビルダー。

本書は実装仕様の完成版であり、ここに書いた未決営業条件を既に承認したという意味ではない。現在の実装者へは、安定化完了後に範囲と公開gateを確認してから着手させる。

## 22｜撮影・原稿制作の発注チェック

### 初期コンテンツの必要量
最初の18販売商品を基準に、日本語・英語の名称、用途一文、内訳、3つ以内のbenefit、注意点、料金key、関連FAQを用意する。ただし同じ説明を18枚コピーせず、共通部分はblock化し、商品固有の差だけを書く。

撮影は全商品に完全固有4枚を強制しない。共通する試着・店舗・利用場面は権利と整合を確認して再利用し、COVERは何が含まれるかを正確に伝える写真にする。18商品×4枚＝必須72枚という数合わせを目的にしない。

| 制作対象 | 必須確認 |
|---|---|
| セット写真 | 全用品が分かる、別料金品が混ざらない、背景と明度がそろう |
| 代表板の写真 | 当季の実取扱いか、モデル・色の非確約表示が必要か |
| 店舗写真 | 実際の入口・受付場所・看板と合うか |
| 人物写真 | 商用掲載・言語/地域・期間の許諾を記録できるか |
| 説明 | 値段以外に差を説明できるか、根拠のない性能・安全保証がないか |
| 英語版 | 用品内訳・時刻・割引・取消条件が日本語版と一致するか |

### 制作担当に渡す原稿フォーマット
offer_code、locale、公開名、用途一文、benefits、本文blocks、必須注意、FAQ参照、写真role/order、alt/caption、権利ID、確認者。CMSへ登録する前に、商品実態と規約を担当者が確認する。

実ページのコピーは「購入意欲をそそる」だけでなく、「自分に必要なセットだと分かる」「総額と受取手順が分かる」「途中で間違えても戻れる」を優先する。カウントダウンは本物のHOLD期限だけ。閲覧者数・人気ランキング・売切れ演出を捏造しない。

## 23｜出典とトレーサビリティ

### 規範・技術資料
**N01｜国税庁：総額表示の義務付け**
日本の消費者向け価格の税込総額表示。適用・税務前提は事業者確認。
出典：https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6902.htm

**N02｜消費者庁：通販事業者向け最終確認画面**
申込確定直前の契約事項と有償申込の明確化。
出典：https://www.caa.go.jp/policies/policy/consumer_transaction/amendment/2021/notice02/

**N03｜消費者庁：二重価格表示**
比較対象の同一性・実在性・明瞭性。架空の通常価格を作らない。
出典：https://www.caa.go.jp/policies/policy/representation/fair_labeling/representation_regulation/double_price

**N04｜W3C：WCAG 2.2**
AA適合を目標。ターゲット最小24 CSS px等には例外条件がある。
出典：https://www.w3.org/TR/WCAG22/

**N05｜Google / web.dev：Core Web Vitals**
LCP2.5秒・INP200ms・CLS0.1、75パーセンタイル。実測目標と達成は別。
出典：https://web.dev/articles/vitals

**N06｜OWASP：File Upload Cheat Sheet**
形式・内容・容量・保存場所・認可の多層防御。
出典：https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

**N07｜OWASP：CSV Injection**
表計算ソフトでの数式解釈から情報漏出等が起きるリスク。
出典：https://owasp.org/www-community/attacks/CSV_Injection

**N08｜Cloudflare：R2 presigned URLs**
署名URLは期限内に再利用可能なbearer権限であり、一回限りではない。
出典：https://developers.cloudflare.com/r2/api/s3/presigned-urls/

**N09｜Cloudflare：R2 CORS**
ブラウザのdirect uploadにCORSが必要。CORSを本人認証とみなさない。
出典：https://developers.cloudflare.com/r2/buckets/cors/

**N10｜AWS：S3 presigned upload**
同じキーへのuploadは置換するため、公開キーを署名upload先にしない。
出典：https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html

**N11｜Square：Web Payments SDK**
クライアントでtokenを作りサーバーのPayments APIで処理。SDKだけで請求完了ではない。
出典：https://developer.squareup.com/docs/web-payments/overview

### 固定SHAの既存コード
**R01｜PR #9状態**
https://github.com/ginisato-hash/zao-rental/pull/9

**R02｜QuoteService（StaffPrincipal・非公開見積）**
https://github.com/ginisato-hash/zao-rental/blob/8467d11a53f74a7028c9a5d92ef2d3b00600c598/packages/core/src/pricing/quote-service.ts

**R03｜台帳契約**
https://github.com/ginisato-hash/zao-rental/blob/8467d11a53f74a7028c9a5d92ef2d3b00600c598/packages/contracts/src/ledger.ts

**R04｜料金契約と216明示値の参照**
https://github.com/ginisato-hash/zao-rental/blob/8467d11a53f74a7028c9a5d92ef2d3b00600c598/packages/contracts/src/pricing.ts

### 124事例の出典
全URL、観測、ZAO向け提案、留意点、確認範囲は CASEBOOK_124.xlsx / CASEBOOK_124.md / cases.csv に収録。同一ブランド・別機能を別事例に数えている。研究資料であり、競合文言・コード・写真を複製する許可ではない。