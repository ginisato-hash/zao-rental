# Real catalog / receipt / photo intake procedure

現状はstageStockImport→commitImportDryRunまで。最後の名前にcommitがあってもapplied=false、DB書込みなし。**実在庫のtransactional import writerと実commit許可は未完了**。ここを手順書だけで完成扱いにしない。

1. 原本を承認済みprivate保管へ受領（今は未接続）。document SHA256、提供者の権限、sheet/page/row、メーカーcatalog／当店入荷証憑の区分を記録。PDF・写真に個人情報があれば公開repo/reviewへ入れない。Salomon全SKU／3季分が揃っていると推測しない。
2. CSV headerは既存import-staging.tsの10列。原値を保持し、trimだけnormalize。model/season/variant/manufacturer_skuを既存catalog revisionへexact照合。fuzzy一致や写真からの個体数推定をしない。
3. dry-runでsource hash／stage hash／catalog revision／locator／issuesを出す。season空欄・不明はBLOCK（IMPORT_SHAPEまたはEXACT_CATALOG_MAPPING_REQUIRED）。数量unit不明／数量不明はBLOCK。store split不明はstoreId=nullのunallocatedとして保留（RECEIPT_STORE_REQUIRED）、店舗在庫を増やさない。manufacturerはMANUFACTURER_IS_NOT_STOCK。
4. unresolved一覧をOwner／入荷確認担当が原票で解決。ADDかREPLACE不明、集計と明細矛盾、受領数量減少は別判断。missing rowは削除ではない。店舗配分や個体IDを仮定して埋めない。
5. Assetはスキー／両ブーツ1組1ID、ボード1枚1ID。POLEはPAIR_QUANTITY。wear jacket/pantsはPIECE_QUANTITYでAsset IDなし。約200着は上下／サイズ／店舗内訳を示す実明細ではない。原票の単位が違う場合は明示的に確認する。
6. 写真はメーカー／season／model／variantへの証拠を保持し、rights未確認ならprivate／unpublished。rights確認なしにdry-run成功を公開許可としない。写真取込と店舗入荷は別承認。
7. explicit dry-run commit直前に全unresolved=0、expected stage hash、最新catalog revision、既存source履歴／Asset ID集合で再検証する。同じsource再送はALREADY_IMPORTED、source変更は要照合、ID衝突は拒否。
8. 実commitを将来承認するときは対象ファイルhash・追加数／unit／店舗・除外行・操作者・版・backup・rollback/補正方法を指定。承認された最小DB権限のwriterを実装／レビューし、全変更を1transaction、再送source/ID一意、監査／参照整合を実DBで検証してから実行する。現行P3ではそのwriter／実データ操作を行わない。

記録票：source/hash____ locator____ catalog revision____ rows____ unresolved____ unallocated____ Asset plan____ quantity plan____ duplicate____ rights____ dry-run result(hash)____ reviewer____ explicit real-commit approval____（空欄は未承認）。
