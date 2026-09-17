# Field acceptance: operator sequence

Physical device scenarios cannot be executed by automation and are recorded `NOT_RUN` until
a person performs them on real hardware. Nothing below may be recorded as `PASS` unless it
was actually observed.

A run needs one run ID (a UUID) reused across every record, so results group together. The
recording staff account needs `OPERATIONS_VIEW` and `FIELD_ACCEPTANCE`, and records are
per-store: record at the store where the step was performed.

## Before starting

- real inventory imported and labels printed for the items being used
- both stores' staff accounts able to sign in on the devices under test
- payment left OFF; no customer, no card, no charge

## Device scenarios — one iPhone and one Android

| scenario | device | what to do | PASS means |
| --- | --- | --- | --- |
| `IPHONE_QR_SCAN` | `IOS` | scan a printed ski label | the correct Asset opens, first try |
| `ANDROID_QR_SCAN` | `ANDROID` | scan the same label | the same Asset opens |
| `DUPLICATE_SCAN` | `IOS` or `ANDROID` | scan the same label twice quickly | the second scan changes nothing |
| `CAMERA_PERMISSION_DENIED` | `IOS` or `ANDROID` | deny camera permission, then try to scan | a clear message and a manual fallback, no crash |
| `OFFLINE` | `IOS` or `ANDROID` | turn off networking mid-task | the app says so plainly and loses nothing |
| `RECONNECT` | `IOS` or `ANDROID` | restore networking | work resumes without a duplicate |
| `MANUAL_ASSET_ID_FALLBACK` | any | type the Asset ID instead of scanning | the same Asset opens |
| `LABEL_DAMAGED_MANUAL_FALLBACK` | any | use a deliberately obscured label | staff can still proceed by ID |

Notes are a fixed list: `NONE`, `CAMERA_PERMISSION_DENIED`, `OFFLINE_QUEUED`, `RECONNECTED`,
`SCAN_TIMEOUT`, `LABEL_UNREADABLE`, `MANUAL_FALLBACK_USED`, `DUPLICATE_SCAN_IGNORED`,
`DEVICE_UNAVAILABLE`, `BLOCKED_BY_PERMISSION`, `SEE_OPERATIONS_EXCEPTION`. There is no free
text field, so no customer detail can be written down here.

A scenario is bound to the device it belongs to: an iPhone scan can only be recorded from
`IOS` and an Android scan from `ANDROID`. Recording a phone scenario from a desktop is
refused by the database, not merely discouraged.

## Staff rehearsal scenarios

Performed through the ordinary screens with real imported stock and **no real payment**.

`CHECKOUT`, `PARTIAL_RETURN`, `CROSS_STORE_RETURN`, `INSPECTION_REQUIRED`, `POLE_QUANTITY`,
`WEAR_QUANTITY`.

Any step that would need a real charge stays `NOT_RUN` until the Owner authorises a
controlled payment separately.

## Reading the result

`/admin/launch` shows `FIELD_DEVICE` and `STAFF_REHEARSAL`. Both are `NOT_RUN` until every
scenario in their group has a result, and a single `FAIL` anywhere blocks the row. Across the
two stores the worst result wins, so one store's failure is never hidden by the other's pass.
