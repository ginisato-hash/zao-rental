# P85 UI — 素材・名称変更の記録

製品に入れるのは派生ファイルだけ。原本・参考CSS・参考スクリーンショットは製品repoに入れない（ローカルの `.local/p85/` に保全）。

## ロゴ（受領：`salomonlogos.zip` sha256 `046bb77fc899908a166e0f9663c09a63b55cd348dad2278bdba6a68d3e0d6cbf`）

権利：Ownerが、SALOMONロゴのWeb使用と色変更を許可済み（Issue #47 6090166024、2026-10-09のユーザーメッセージ）。

| 原本 | 原本 sha256 | 加工 | 製品ファイル | sha256 | 用途 |
|---|---|---|---|---|---|
| 3.png（縦組） | `c5aa60ff0ba4a88a4b86957a6959be82ddd74e108bdfab12ea01dbdd9d7a1cb3` | トリム（2532×545、4.65:1）→ 白 → 高さ112px | `apps/web/src/components/brand/logo-stacked-white.webp`（520×112） | `fa2033cc87eabff2756dbe89095de33e94d697d5b309928b2940587166a893e2` | ヘッダーピル。PC・モバイル・予約画面とも表示高さ26px（P85-03で選定、COMPARISON.md） |
| 3.png（縦組） | 同上 | トリム → 黒 → 幅480px | `logo-stacked-black.webp`（480×103） | `d5b7dad0b2db18eb8c8d1cf26d91c2f2dd7bfcdb153b413ccc09376d959dd4ac` | フッター右端（幅160px。Palaceの回転ロゴと同じ位置、静止画） |
| 2.png 横長／4.png ワードマーク | `aee86bae…6e85`／`e6ffd876…d617` | P85-03の比較のためにトリム・白版を作成（`.local/p85/assets/logos/`） | 製品では不使用（初版の派生ファイルは削除） | — | 不採用（理由は COMPARISON.md） |

- 加工は、透過余白のトリム（alpha閾値1）、アルファを保ったRGBの塗り替え、比率を保った縮小だけ。変形はしていない。
- 3.pngのA・N付近にある微小な半透明の筋は原本の画素なので、加工していない。

## 写真（Salomon公式 skiing ページ。Ownerが公式タイアップとして使用承認済み、P85 §5）

取得元ページ：`https://www.salomon.com/en-gb/sports/skiing`。`<picture>` の `source`（PC：min-width 768px、モバイル：max-width 767px）から、CDNの変換クエリを付けない原本URLで取得した（2026-10-10 UTC）。原本6点（MIME・実寸・sha256・URL）は `.local/p85/assets/photos-src/manifest.json` に記録。

| 企画 | 原本（PC／モバイル） | 原本 sha256（PC／モバイル） | 製品派生（PC／モバイル） | 派生 sha256（PC／モバイル） | クロップ（object-position） |
|---|---|---|---|---|---|
| WINTER 26/27 → 予約 | SlimBanner MEN Desktop 3840×1066 ／ MEN mobile 750×1000 | `d53c3c7a…2b14` ／ `6870db89…a224` | `campaign-winter-desktop.webp` 3200w ／ `campaign-winter-mobile.webp` 750×1000 | `cbca8b79…a3a1` ／ `a1234e9a…4629` | PC `72% 50%`（右側の滑走者を残す）／ モバイル `50% 50%` |
| SKI → スキー | HERO_CARD_EQUIPE_Alpine 1916×1916 ／ 750×1000 | `1a9c977e…7a9f` ／ `d514740d…5848` | `campaign-ski-desktop.webp` 1600×1600 ／ `campaign-ski-mobile.webp` | `3b9d6212…b5d4` ／ `f61434e9…f0f6` | PC `50% 40%` ／ モバイル `50% 50%` |
| WEAR → ウェア | SlimBanner WOMEN Desktop 3840×1066 ／ WOMEN mobile 750×1000 | `889220ab…a855` ／ `4ab7135d…f8ba` | `campaign-wear-desktop.webp` 3200w ／ `campaign-wear-mobile.webp` | `11a7bfde…c118` ／ `ef865dbc…9271` | PC `64% 50%`（人物を中央寄りに残す）／ モバイル `50% 50%` |

使い方の制約：
- 写真はすべてスキー。スノーボードの企画・商品には使わない（このため企画ホイールにSNOWBOARDは入れていない。ナビとフッターには残す）。
- 蔵王の実景、または当店在庫のモデルとしては表示しない。MEN写真の山は蔵王ではない。altは「Salomon公式写真」と明記。
- hotlinkはしない（派生ファイルをバンドル）。
- 企画のアクセント色は各写真の画素から採った値（WINTER #E0A020、SKI #80C0E0、WEAR #C0A080）。ボタン文字は黒（コントラスト確保）。

## 書体

`barlow-semi-condensed-700.woff2`（15,784 B、sha256 `bc8aadf92982fed8deaee6118c0c301fe3c0cf2890d168c6881de95bf80abcf7`）。SIL Open Font License 1.1（`OFL-BarlowSemiCondensed.txt` を同梱）。選定根拠は ELEMENTS.md の「代替書体の実測選定」：Palaceの太字フェイスとの幅差 ≤1.1%。

## 店名の表示変更（Owner決定：MOUNTAIN_BASE → Mountain Station、ONSEN_BASE → Central Station）

- 変えたのは表示だけ。内部ID・DBキー・Square location・APIの値・URL（`/stores/mountain-base` 等）・履歴・migration・固定ファイルは変更していない。
- 共通の表示辞書：`packages/contracts/src/store-display.ts`（`STORE_DISPLAY_NAMES`／`storeDisplayName`）。参照しているもの：
  - 画面：お客様向け（`guest-format.ts` の `STORE_LABEL` はこの辞書の写し）、スタッフ画面の店舗選択・予約詳細・移動・ウェア・運用例外・台帳。
  - 予約確認メール（JA／EN、`packages/core/src/notification/contracts.ts`）。
  - 今後追加する帳票も、この辞書を使う。
- 回帰テスト：`tests/unit/store-display.test.ts`（UIのソースが店舗IDを直接表示しないこと）、`tests/unit/notification.test.ts`（メールに表示名だけが出て、内部IDが出ないこと）。
- 選択肢の `value` は内部IDのまま（送信値は不変）で、表示ラベルだけを変えた。
- 承認済みの法定文書は、本文中の店名だけを置換した（他の文言は不変）：

| ファイル | 置換 | 前 sha256 | 後 sha256 |
|---|---|---|---|
| `config/content/public-legal.json` | Mountain Base→Mountain Station ×2、Onsen Base→Central Station ×2（JA・ENの受渡し条項） | `76fd151a0b4ba4ac3221bd2746b137ec3b3e7883fb4a154a17f905d1b0270287` | `ef1f0aacaaa87161200954ce5ed44c7e9eb8bfcbf31c5f4eab25a100b4f871c9` |
| `config/content/public-p0-pages.json` | 同 ×4 ずつ（店舗ページの見出し・タイトル） | `fd022dc54470c0f8671e3d9c71cac40b27208295c238e86e9d4463d962399880` | `b384639f2389d0949f810a3a311ee256ace4840827c3281becbb8928b023502e` |
