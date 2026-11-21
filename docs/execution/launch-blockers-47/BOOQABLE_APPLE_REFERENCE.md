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
| Run report：選択期間の印刷可能な出庫レポート（B1） | Dashboard「作業リストを印刷」→ Documents作業リスト（Dashboardの店舗・期間をそのまま、Dashboardと同じ抽出規則・同一snapshot、上限超は日別の完全リストへ分割、不完全なリストは印刷不可）（DASH-PRINT-01） | 一致（2026-11-20 後任B） |
| Dashboardのメモ欄（B1） | なし | **差分**。業務データが無いため、見せかけの欄は追加しない |
| AIアシスタント（B1） | なし | 対象外（Owner要件外） |
| 状態：Draft / Reserved / Picked up / Returned / Archived、部分状態Mixed（B2） | 下書き（未決済）/ 予約済み / 貸出中 / 一部返却・返却済み・点検待ち。部分貸出・部分返却を区別 | ほぼ一致。**Archivedは未実装（差分）** |
| 受取時に個体をスキャンまたは手動で選択（B2） | Scan、貸出・返却画面で個体QR／IDを照合（既存の貸出・返却フロー） | 一致 |
| CSV export：Orders / Documents / Customers / Inventory / Reports（B3） | Reports / Orders / Customers / Inventory のCSV（各画面の読取・絞込みと同一の全ページ、現権限・店舗、数式無害化、JA/EN見出し、no-store、REP-02保存ガード共通） | 一致。**Documents（書類）のCSVは対象外**：当方の書類は個別印刷物で一覧データを持たない |
| 新規注文のブラウザ通知（B4） | 永続の受信箱（ベル）・明示の既読化、任意のメール通知（初期OFF）、任意のブラウザ通知（本人がON・許可、管理画面のタブが開いている間のみ、非表示タブで約1分ごと、ブラウザ1つにつき1通知）（BROWSER-01） | 一致。閉じたブラウザへの配信は無い（Booqableも同様に開いている間の補助経路）。受信箱とメールが本筋 |

## 3. 視覚・文章の対照（Apple A1〜A3 ↔ 当方）

| 観点 | 当方の実装 | 判定・根拠 |
|---|---|---|
| 明瞭な階層（A1） | 1画面1つのh1、主要操作は右上の1つ（例：新規予約、CSV） | 実装済み。staff/admin 33ルート×JA/EN×1440/390の一括受入で構造崩れ0 |
| 余白と整列、レスポンシブ（A2） | 共通シェル（サイドバー＋内容）、390pxでメニュー化、行内スクロールのセグメント | 390pxで横スクロール0（staff 132頁・公開64頁の受入） |
| 簡潔な文言、言語一貫性（A3） | 全画面JA/EN、英語画面に日本語UI文言0（合成カタログ名を除く）、ヘルプ文は1文中心 | 一括受入で検査 |
| 色・タイポグラフィ | system font、白/グレー、青のアクセント、hairline | CSSトークンで統一 |

この表は構成と原則の対照であり、Apple・Booqableの見た目を100%再現したという主張ではない。

## 4. 残る差分（見せかけの追加はしない）

1. ~~Orders / Customers / Inventory のCSV export~~ → 実装済み（`2a2bde9`）。
2. ~~Dashboard → 作業リスト（印刷）~~ → 実装済み（`db255f7`）。
3. ~~新規予約のブラウザ通知~~ → 既存のopt-in通知を是正（`db255f7`）。
4. Archived（B2）：現行の状態・監査に関わるため、Owner判断なしに新設しない（据え置き）。
5. Dashboardのメモ欄（B1）：業務データが無いため追加しない（据え置き）。

## 5. UX-02 受入マトリクス（実在の合成データ、2026-11-20 後任B）

「実在」= 合成ローカルPGに予約・顧客・個体を実際に作成し、その実IDで開いた画面（存在しないUUIDでの404確認は別試験）。証跡は各試験のPASS行と `.local/evidence/` のスクリーンショット（リポジトリ外・未commit）。

| 観点 | 対象 | 方法 | 証跡 |
|---|---|---|---|
| 予約詳細（実データ） | 実予約 `#<ref>` | 見出しが予約番号、not-found文言0、印刷用の予約確認書へ同じ予約で遷移 | `test:staff-acceptance-ui` UX-02、`ux02-*-order.png` |
| 顧客詳細（実データ） | 予約に紐づく実顧客 | 見出しが顧客名（同一メールの最新予約名） | 同上 `ux02-*-customer.png` |
| 商品詳細（実データ） | 実個体の商品（店舗別在庫・サイズ） | 見出し・サイズ表・日付別予約可否 | 同上 `ux02-*-product.png` |
| スキャン | 実個体ID／他店個体の拒否 | 既存のScan試験 | acceptance-ui「scan:」2件、UX-02 `ux02-*-scan.png` |
| 幅・倍率 | 上記4画面 | 1440px、390px、200%ズーム（720 CSS px×DPR2）で横スクロール0 | UX-02 |
| 言語 | 上記4画面＋全33 staff/admin route | JA/EN、`html lang`一致、英語画面に日本語UI文言0 | UX-02、`test:staff-all-routes-ui`（132頁） |
| キーボード | 上記4画面 | 先頭からTabで`main`内の操作に到達し、可視のフォーカス表示がある | UX-02 |
| 店舗・権限 | 予約/在庫のみの職員、他店舗 | 閲覧不可の画面・他店個体の拒否、CSVの他店舗0 | acceptance-ui「scan:」、orders-postgres CSV/SNAP-01 |
| 業務の流れ（QR→予約→規約→支払UI→準備・貸出・返却・点検→書類） | 公開予約〜スタッフ業務 | 既存の通し試験を本HEADで実行（結果はPR #73へ記録） | `test:public-ui`、`test:flow-ui`、`test:readiness-ui`、`test:custody-ui`、`test:human-ui` |

限界（偽らない）：Squareのカード入力は公式のテスト用フィクスチャで、実カード・実課金は行わない。Apple HIGの本文はJS殻のため機械照合できず、上表は原則と当方画面の対照に留まる。「Booqable/Appleの100%再現」は主張しない。
