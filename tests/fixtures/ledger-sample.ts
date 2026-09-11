// Hand-authored, deliberately small SYNTHETIC fixture; no workbook, customer or real asset data.
// Store allocation, IDs, sizes and BSL scenarios are placeholders, not observed inventory.
export const SAMPLE = {
  "models": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "data": {
        "code": "DEMO-SKI",
        "name": "検証用スキー",
        "brand": "架空モデル",
        "family": "SKI",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "models/1"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "data": {
        "code": "DEMO-SNOWBOARD",
        "name": "検証用ボード",
        "brand": "架空モデル",
        "family": "SNOWBOARD",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "models/2"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000003",
      "data": {
        "code": "DEMO-SKI_BOOT",
        "name": "検証用スキーブーツ",
        "brand": "架空モデル",
        "family": "SKI_BOOT",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "models/3"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000004",
      "data": {
        "code": "DEMO-SNOWBOARD_BOOT",
        "name": "検証用ボードブーツ",
        "brand": "架空モデル",
        "family": "SNOWBOARD_BOOT",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "models/4"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000005",
      "data": {
        "code": "DEMO-POLE",
        "name": "検証用ポール",
        "brand": "架空モデル",
        "family": "POLE",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "models/5"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000006",
      "data": {
        "code": "DEMO-WEAR",
        "name": "ウェア（管理単位未確定）",
        "brand": "架空モデル",
        "family": "WEAR",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "models/6"
      }
    }
  ],
  "variants": [
    {
      "id": "00000000-0000-4000-8000-000000000101",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000001",
        "family": "SKI",
        "age": "ADULT",
        "tier": "REGULAR",
        "size": "160 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/101"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000102",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000001",
        "family": "SKI",
        "age": "KIDS",
        "tier": "REGULAR",
        "size": "100 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/102"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000103",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000001",
        "family": "SKI",
        "age": "ADULT",
        "tier": "PREMIUM",
        "size": "170 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/103"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000104",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000002",
        "family": "SNOWBOARD",
        "age": "ADULT",
        "tier": "REGULAR",
        "size": "150 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/104"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000105",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000003",
        "family": "SKI_BOOT",
        "age": "ADULT",
        "tier": "REGULAR",
        "size": "26.5 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/105"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000106",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000004",
        "family": "SNOWBOARD_BOOT",
        "age": "ADULT",
        "tier": "REGULAR",
        "size": "26.5 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/106"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000107",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000005",
        "family": "POLE",
        "age": "ADULT",
        "tier": "REGULAR",
        "size": "110 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/107"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000108",
      "data": {
        "modelId": "00000000-0000-4000-8000-000000000005",
        "family": "POLE",
        "age": "KIDS",
        "tier": "REGULAR",
        "size": "85 cm",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "variants/108"
      }
    }
  ],
  "assets": [
    {
      "id": "00000000-0000-4000-8000-000000000201",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000101",
        "family": "SKI",
        "storeId": "MOUNTAIN_BASE",
        "status": "UNVERIFIED",
        "bslStatus": "NOT_APPLICABLE",
        "bslMm": null,
        "bslEvidence": "",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "assets/201"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000202",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000102",
        "family": "SKI",
        "storeId": "ONSEN_BASE",
        "status": "UNVERIFIED",
        "bslStatus": "NOT_APPLICABLE",
        "bslMm": null,
        "bslEvidence": "",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "assets/202"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000203",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000103",
        "family": "SKI",
        "storeId": "ONSEN_BASE",
        "status": "UNVERIFIED",
        "bslStatus": "NOT_APPLICABLE",
        "bslMm": null,
        "bslEvidence": "",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "assets/203"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000204",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000104",
        "family": "SNOWBOARD",
        "storeId": "MOUNTAIN_BASE",
        "status": "UNVERIFIED",
        "bslStatus": "NOT_APPLICABLE",
        "bslMm": null,
        "bslEvidence": "",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "assets/204"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000205",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000105",
        "family": "SKI_BOOT",
        "storeId": "MOUNTAIN_BASE",
        "status": "UNVERIFIED",
        "bslStatus": "UNVERIFIED",
        "bslMm": null,
        "bslEvidence": "",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "assets/205"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000206",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000106",
        "family": "SNOWBOARD_BOOT",
        "storeId": "ONSEN_BASE",
        "status": "UNVERIFIED",
        "bslStatus": "NOT_APPLICABLE",
        "bslMm": null,
        "bslEvidence": "",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "assets/206"
      }
    }
  ],
  "poles": [
    {
      "id": "00000000-0000-4000-8000-000000000301",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000107",
        "storeId": "MOUNTAIN_BASE",
        "status": "UNVERIFIED",
        "quantity": 6,
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "poles/301"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000302",
      "data": {
        "variantId": "00000000-0000-4000-8000-000000000108",
        "storeId": "ONSEN_BASE",
        "status": "UNVERIFIED",
        "quantity": 4,
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "poles/302"
      }
    }
  ],
  "bundles": [
    {
      "id": "00000000-0000-4000-8000-000000000401",
      "data": {
        "code": "DEMO-SKI_SET",
        "name": "スキーセット（構成定義）",
        "family": "SKI_SET",
        "age": "ADULT",
        "tier": "REGULAR",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "bundles/401"
      }
    },
    {
      "id": "00000000-0000-4000-8000-000000000402",
      "data": {
        "code": "DEMO-SNOWBOARD_SET",
        "name": "ボードセット（構成定義）",
        "family": "SNOWBOARD_SET",
        "age": "ADULT",
        "tier": "REGULAR",
        "notes": "検証用の合成サンプル。実在庫ではありません。",
        "sourceKind": "SYNTHETIC",
        "sourceDocument": "tests/fixtures/ledger-sample.ts",
        "sourceLocator": "bundles/402"
      }
    }
  ]
} as const;
export const fixtureId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
