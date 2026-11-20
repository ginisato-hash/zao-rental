# Booqable（構成）/ Apple（視覚）参照台帳と画面対照（Issue #47 TD監査 #7027993255 UX-02）

作成：2026-11-20 JST、実装担当Claude。参照元の本文・画像は著作物のため転載しない。URL、取得時刻、HTTP状態、取得したHTMLのSHA-256と、当方画面との対照だけを記録する。

## 1. 参照台帳（2026-11-20 取得、`curl -sL`）

| # | 参照 | URL | 取得(UTC) | HTTP | SHA-256（取得HTML） | bytes |
|---|---|---|---|---|---|---|
| B1 | Booqable Dashboard | https://help.booqable.com/en/articles/5603615-how-to-use-the-dashboard | 2026-11-20T02:54:48Z | 200 | `727e584b6859f542e5b90bd6028307f42d927d9f7834945d8fce69c0e463b409` | 86329 |
| B2 | Booqable Order workflow | https://help.booqable.com/en/articles/3845244-the-booqable-order-workflow | 2026-11-20T02:54:49Z | 200 | `1fe72040dae2b93a1666a4fb0597e315de32f51bae3b6e3633bc1fdc9519a7b4` | 116494 |
| B3 | Booqable Export | https://help.booqable.com/en/articles/5603655-how-to-export-information-from-your-account | 2026-11-20T02:54:50Z | 200 | `b2528547b2f5fdda5f524dc2df5164accb575f244ada695a92cf144a723d935b` | 98450 |
| B4 | Booqable Browser notifications | https://help.booqable.com/en/articles/8065172-receiving-browser-notifications-from-booqable | 2026-11-20T02:54:50Z | 200 | `e5fc706524bf009e70228fb933d5366d0dc86a2f878fbf4e475b7cf766e2ef7d` | 75518 |
| A1 | Apple HIG Design principles | https://developer.apple.com/design/human-interface-guidelines/design-principles | 2026-11-20T02:54:51Z | 200 | `dcd8e79c4cbd75a563761991b8251046f53b95807663afa5a298405b370407ee` | 17993 |
| A2 | Apple HIG Layout | https://developer.apple.com/design/human-interface-guidelines/layout | 2026-11-20T02:54:52Z | 200 | `e3556b97799162581ecc62a8d518da7b8d39cbbd9a3cffd7778aff328062b761` | 18161 |
| A3 | Apple HIG Writing | https://developer.apple.com/design/human-interface-guidelines/writing | 2026-11-20T02:54:53Z | 200 | `226d2bca39021e0f14c434cbb32fb3c107fec6c562ba60f070ca5bf6c9428139` | 17903 |

注：A1〜A3は本文をクライアント側で描画するアプリ殻のため、hashは取得した殻HTMLの値で、記事本文そのものを固定しない。

## 2. 業務構成の対照（Booqable B1〜B4 ↔ 当方）

| Booqableの要素（要旨） | 当方の画面 | 判定 |
|---|---|---|
| ログイン後の最初の画面がDashboard（B1） | サインイン後 `/staff`（Dashboard）。予約閲覧権限が無い職員は、使える最初の画面（在庫、無ければ当日作業）へ（UX-01） | 一致 |
| 当日（または指定期間）のGoing out / Coming back（B1） | Dashboard：貸出予定 / 返却予定、期間切替（日付・範囲） | 一致 |
| 遅れた受取・返却の通知（B1） | Dashboard の受取遅れ・返却遅れ件数と、同じ集合のOrdersへのリンク（方向・店舗つき） | 一致 |
| Run report：選択期間の印刷可能な出庫レポート（B1） | Documents「作業リスト」（店舗・日付の貸出予定／返却予定を印刷）、Reports（期間・店舗・CSV） | 機能は一致。Dashboardからの直接ボタンは**未設置（差分）** |
| Dashboardのメモ欄（B1） | なし | **差分**。業務データが無いため、見せかけの欄は追加しない |
| AIアシスタント（B1） | なし | 対象外（Owner要件外） |
| 状態：Draft / Reserved / Picked up / Returned / Archived、部分状態Mixed（B2） | 下書き（未決済）/ 予約済み / 貸出中 / 一部返却・返却済み・点検待ち。部分貸出・部分返却を区別 | ほぼ一致。**Archivedは未実装（差分）** |
| 受取時に個体をスキャンまたは手動で選択（B2） | Scan、貸出・返却画面で個体QR／IDを照合（既存の貸出・返却フロー） | 一致 |
| CSV export：Orders / Documents / Customers / Inventory / Reports（B3） | Reports のCSV（画面と同一の行・列、数式無害化） | Reportsは一致。**Orders / Customers / Inventory / Documents のCSVは未実装（差分）** |
| 新規注文のブラウザ通知（B4） | 永続の受信箱（ベル）・明示の既読化、任意のメール通知（初期OFF） | 同等の業務目的。**OSのブラウザ通知（Notification API）は未実装（差分）** |

## 3. 視覚・文章の対照（Apple A1〜A3 ↔ 当方）

| 観点 | 当方の実装 | 判定・根拠 |
|---|---|---|
| 明瞭な階層（A1） | 1画面1つのh1、主要操作は右上の1つ（例：新規予約、CSV） | 実装済み。staff/admin 33ルート×JA/EN×1440/390の一括受入で構造崩れ0 |
| 余白と整列、レスポンシブ（A2） | 共通シェル（サイドバー＋内容）、390pxでメニュー化、行内スクロールのセグメント | 390pxで横スクロール0（staff 132頁・公開64頁の受入） |
| 簡潔な文言、言語一貫性（A3） | 全画面JA/EN、英語画面に日本語UI文言0（合成カタログ名を除く）、ヘルプ文は1文中心 | 一括受入で検査 |
| 色・タイポグラフィ | system font、白/グレー、青のアクセント、hairline | CSSトークンで統一 |

この表は構成と原則の対照であり、Apple・Booqableの見た目を100%再現したという主張ではない。

## 4. 残る差分（実装候補、見せかけの追加はしない）

1. Orders / Customers / Inventory のCSV export（B3）：既存の一覧と同じ条件・権限・行で出力し、Reports CSVと同じ安全処理（数式無害化、セッション束縛）を適用する。
2. Dashboard → 作業リスト（印刷）への「レポートを実行」導線（B1）。
3. 新規予約のブラウザ通知（B4）：任意のON設定、受信箱と同じ店舗scopeで、ページを開いている間だけ通知する。
4. Archived（B2）：現行の状態・監査に関わるため、Owner判断なしに新設しない。
