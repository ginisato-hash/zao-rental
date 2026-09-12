# ADR0021: content and photograph import foundations

The owner-adopted UI/CMS P0 remains within FLOW-DEV-R1, with the original budget.
This checkpoint provides pure, bounded import/preview logic and synthetic tests only;
no public release, staff CONTENT permission, provider/storage account or real photograph
has been created. These helpers are not a complete CMS or an authentication boundary.

Text imports use the supplied seven-column schema, five MiB/1000rows/200targets.
Known offer/locale and expected revision are mandatory. SET/KEEP/CLEAR affect only
plain-text title, summary and fit_note. Unknown offerings, prices, stock, HTML, duplicate
fields and stale revisions fail. A bad row excludes its whole offer/locale target.
A plan hash is correspondence evidence, not approval. The future DB adapter must persist
trusted plans, authorize each operation and compare-and-swap within the transaction.
JSON is the machine round-trip; spreadsheet-facing CSV escapes formula prefixes.
There is currently no production apply endpoint or anonymous import route.

Photographs use sharp0.35.4, already present through Next and now an explicit pinned
dependency. The byte-only function allows JPEG/PNG/WebP,200files,10MiB each,25MP,
500MiB total, processed sequentially. It rejects path names, duplicate names, extension/
decoded-format mismatch, animation and failed decode. A real decoder re-encodes oriented,
bounded WebP derivatives without preserving metadata. No arbitrary URL fetch or original
public serving. Every binding/season/sport and rights record remains UNVERIFIED/DRAFT_ONLY,
even when bytes are identical. Original private storage, malware operations, photo rights,
content release rollback and complete owner-photo workflows are not connected.

Official sharp references consulted for constructor limits, orientation and metadata:
https://sharp.pixelplumbing.com/api-constructor/
https://sharp.pixelplumbing.com/api-output/

Both ski and snowboard photo inputs are supported. No owner photographs have arrived;
synthetic test buffers do not establish a real model/season or image rights. The Salomon
source index is a portal index, not a complete extracted three-season SKU catalog.
Neither content nor photo imports generate physical stock. Quantity imports still require
source/row reconciliation and approved actual counts;200 wear units remain ambiguous.
