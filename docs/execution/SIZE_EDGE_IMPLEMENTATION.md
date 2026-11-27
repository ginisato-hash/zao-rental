# SIZE-EDGE 実装記録（Issue #47 コメント 7197143646「A. SIZE-EDGE」）

rule version: `HEIGHT_MINUS_20_WINDOW_15_BOOT_PLUS_1_EDGE_V2`（V1 は読取・選択とも引き続き可。V1 データへ fit を後付けしない）。

## 仕様 -> 実装

| 仕様 | 実装 |
|---|---|
| A1 単一正本 | `packages/contracts/src/recommendation.ts` `buildMembers(..., edge)` / `rankCandidates(..., window)` / `bootOptions(..., maxDistance)`、`packages/contracts/src/size-edge.ts`（分類・enum・限度）。団体は同じ関数を `edge=true` で呼べる。 |
| 通常結果の保護 | edge 経路は「通常経路が catalog 側の理由（NO_CATALOG_LENGTH / BOOT_SIZE_NOT_FOUND）で候補ゼロ」の時だけ起動。通常窓に在庫候補がある・在庫不足・INDETERMINATE・TRANSFER_PLAN_REQUIRED・売止は edge に変換しない。通常経路の候補は V1 とバイト同一（fit 欄なし）。 |
| 境界候補 | 板/ポール: 目標からの距離昇順・同距離は短め。ブーツ: 共有シェル lo/hi への距離、同距離は大きめ。最端が不足なら次に近い実在庫を NEAREST_AVAILABLE。実在する数値 catalog サイズのみ（ラベル推定なし）。年齢・tier・店舗・Premium モデルは不変。 |
| reason 分離 | catalog なし: `NO_CATALOG_LENGTH` / `NO_CATALOG_BOOT`、在庫不足: `INSUFFICIENT`、技術: `INDETERMINATE*`、移動: `TRANSFER_PLAN_REQUIRED`、店舗確認: `MANUAL_FIT_REQUIRED`。 |
| fit metadata | `FitMeta`（kind=NORMAL/EDGE_BELOW/EDGE_ABOVE/NEAREST_AVAILABLE/MANUAL_FIT_REQUIRED、部品別 target/handled range/offered/diff/reason、ruleVersion）。preview の `offered`(JSONB)、selection の `selection.fit`（server が preview から導出）に保存。**DB migration なし**（既存 JSONB の拡張）。 |
| 伝播 | preview -> selection -> quote（selection.quote_id 経由）-> 手配: `custody-service.assignment` の `fitByMember`、`manifest-service` の `preparationMembers[].fit`、`CustodyWorkspace` / `TomorrowPreparation` に表示。 |
| 拘束 | `select()` は直接 `offered` の候補から variant を決め、`exact()` で fit/variant/price 等の余分な欄を拒否。fit は選択時に preview から再導出。 |
| MANUAL_FIT_REQUIRED | 限度（板 30cm、ブーツ 3cm。Owner承認済み 2026-11-27、変更はOwnerの指示による）超過。候補は全て null、情報表示のみ、hold/quote/決済に進めない。ポールは職員が貸出時に調整する付属品のため常に確認フラグのみで、セット全体を止めない。 |
| UI JA/EN | `components/fit-copy.ts`、GuestBooking（候補バッジ・注意文・確認画面）、RecommendationWorkspace（スタッフ）。390px/1280px で確認。 |
| スキーマ上下限 | **変更なし（不要）**。身長50–250・足5–50・体重5–300は実在する体格を既に含む。失敗は入力範囲でなく catalog 側。DIN 閾値も不変（OUTSIDE_TABLE は null のまま）。単位/桁/有限性の誤りは従来通り `INVALID_RECOMMENDATION_INPUT`。 |

## 試験表

| 試験 | 内容 | 結果 |
|---|---|---|
| `tests/unit/size-edge.test.ts`（9） | 分類境界、窓ちょうど15cm、同距離、ブーツ共有シェル、edge無効時同一、スキーマ端、DIN不変 | PASS |
| `npm run test:size-edge`（実PG 13） | 通常回帰、上下端、売切→NEAREST、窓内在庫不足はedgeにならない、MANUAL、ブーツ端、catalog欠損、移動計画、2名最後の1個、不正payload、V1 preview、handoff参照 | PASS |
| `npm run test:size-edge-ui`（9） | JA/EN x 390/1280、通常は表示なし、edge表示+注意文+確認画面、MANUAL は選択不可、未選択で hold なし | PASS |
| 既存 `test:recommendation` 17 | 2 箇所の期待値を意図的に変更（下記） | PASS |
| `test:recommendations-ui/-audit/-continuation`、`test:wear`、`test:custody`、`test:staff-order`、`test:flow-ui`、`test:public-guest`、`test:operations-manifest`、`test:preparation-ui`、lint、tsc、`test:unit`(1237) | 回帰 | PASS |

既存試験の変更: `real-postgres.ts` の「ブーツ1.5cm外れ」は V2 で edge 候補になるため、3cm超（足22cm）で MANUAL_FIT_REQUIRED を検証する形に変更。KIDS 在庫なしの reason は `BOOT_SIZE_NOT_FOUND` から `NO_CATALOG_BOOT` に分離（仕様の reason 分離）。試験の削除・skip はなし。

## 限界 / NOT_RUN

- 限度値（板 30cm・ブーツ 3cm）は Owner承認済み（2026-11-27）。メーカー資料に基づく値ではなくOwnerの運用判断。メーカー禁止適合・BSL/ソール互換・解放試験のデータはリポジトリになく、実装していない。
- 通常経路で窓内に在庫があるセットの「ポールだけ範囲外」は fit 表示しない（通常結果保護のため。edge 経路のポールのみ分類）。ポール在庫不足時の「次に近いポール」は未実装（従来動作）。
- スタッフ注文詳細（orders-service）への fit 表示は未実装。保存は quote 経由で参照可能、表示は準備/貸出画面のみ。
- スタッフ preview UI の edge 表示は実装済みだが専用ブラウザ試験なし（既存スタッフ UI 試験の回帰のみ）。
- 団体入口は B 担当。共通 selector（`buildMembers`/`RecommendationService.preview`）は再利用可能な形で提供。
- 20人の edge 負荷計測、体重・スノーボード荷重の edge は未実施。本番操作・実メール・実決済なし。
