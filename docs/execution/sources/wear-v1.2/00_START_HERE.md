# ZAO Rental｜ウェア事前予約＋スキー/ボード統合指示パック v1.2
Pack ID: ZAO-WEAR-CATALOG-UX-20260913-V1_2 / Research date: 2026-09-13

**このZIP1つを、現在のCodexセッションに添付する。旧ZIPを別送する必要はない。**

## 読む順序
1. 01_ADOPTION_AND_PRECEDENCE.md — 承認状態/上書き範囲/既存予算
2. 05_CODEX_HANDOFF.md — 実行順序と停止条件
3. 04_SNOWBOARD_CATALOG_PHOTOS_ADDENDUM.md — ボード写真/モデル契約
4. 03_WEAR_BOOKING_IMPLEMENTATION.md — 衣類個体/予約/清掃/返却
5. 02_WEAR_PRICING_RESEARCH.md + pricing/wear_pricebook_v1_2.proposed.json
6. contracts/acceptance_tests.csv / research/sources.csv
7. reference/の旧UI・カタログ資料は参照。旧価格/写真分担で今回を上書きしない。

## 同梱
previous/ に受領済みv1.1 ZIPをbyte単位で保存。そのSHAはMANIFEST.json。
reference/ はその全展開内容。pricing/ は既存18商品参照と新しいウェア価格/セット合計例。
ZAO_Rental_Wear_Pricing_v1_2.xlsx は単品・セット合計・割引・原価感度・市場比較を計算する検討表（完成版に同梱）。
verification/ は価格ルール参照コード/固定golden例/検証結果。実アプリに未移植。

## 公開禁止/未実施
税区分・現物・清掃能力・価格公開は未承認。chargeReady=false。
旧売上明細/実顧客/実従業員/メーカー納品表は同梱していない。original catalog全文やメーカー画像の転載パックではない。
GitHubへの反映、Codexの起動、アプリテストや本番公開をこのパック生成時に実行したとは扱わない。
