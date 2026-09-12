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
500MiB total input and output, processed sequentially. It rejects path names, duplicate names, extension/
decoded-format mismatch, animation and failed decode. A real decoder re-encodes oriented,
320/640/960/1440/1920 WebP and JPEG derivatives without preserving metadata. No arbitrary URL fetch or original
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

Manufacturer reconciliation now keeps source document/locator, raw row hash, sport,
season, SKU, size, quantity unit and ADD/REPLACE uncertainty. Exact candidates remain
unapproved source matches. Both sports are supported; no three-season coverage is invented.
These are pure source planners, not a completed database catalog importer.

The runtime wear seed inventory metadata points to quantity pools under the owner override.
The original source-pack JSON is unchanged; all24wear and216equipment prices are unchanged.
No garment IDs are created by media or manufacturer import.

Private release planning validates a fixed offer/locale revision set, source translation,
media checksum/readiness/rights expiry and current commercial mapping. Commit recomputes
that set and checks expected-current. Restore produces a new manifest and rechecks current
rights; no old booking or price snapshot changes. Only a pure resulting state/audit/outbox
is implemented and tested with local synthetic state. No persistent CMS transaction,
publication authority, DB role or public route exists; this is not complete CMS P0.


## Supervised local fixture checkpoint

`PrivateContentWorkflow` now persists trusted plans, CAS draft revisions and private
release/current/audit/outbox through an adapter port. The shipped adapter is only
`tests/content/file-fixture.ts`: per-worktree bounded file lock, private atomic rename,
no stale-lock stealing. It reauthorizes the real library session before and after
acquiring the fixture lock. Synthetic CONTENT grants are explicitly seeded in this
fixture file; they are not actual staff DB permissions or a production role change.
The normal apps/web has no CMS fixture route. The development test app also requires
explicit launcher composition and private fixture root; production NODE_ENV rejects it.

Normal password UI can import CSV, preserve invalid targets, recover saved request/job,
create a private release and restore to a new manifest. Old revisions are immutable.
Actual Web-process restart retains file state and the real auth DB session. This is
local fixture persistence, not PostgreSQL CMS isolation, fsync/crash durability,
public publication or a connected production content repository.

Photo jobs pin at most200 filenames, byte counts and SHA256s,500MiB total. Each request
carries at most10MiB of original bytes (14MiB bounded JSON transport). Sequential
real decoding and10 derivatives do not use a reservation DB connection. The local
fixture stores hash-addressed originals and derivatives privately; only authenticated,
job-owner-scoped sanitized320px WebP is renderable. Original files are not served.
A restart/retry resumes exact job/index/hash and never counts a completed item twice.
An explicit pause or leaving the page aborts further client requests; an in-flight
server operation may finish, so the next action reads the existing job first.
Failed commits may leave unreferenced private bytes until the owned fixture is removed;
there is no background cleanup or public orphan route. This is not malware scanning.

Exact offer_code__role__sort filenames yield candidates only, with SERVICE support.
Unknown names and duplicate role/order remain flagged. Source-byte reuse does not
copy rights. Every real photo binding, rights, consent, alt and publication remains
unconfirmed. No actual owner photos or three-season full SKU catalog have arrived.
The normal fixture UI test processes50 synthetic images, loses one response, reloads
and resumes47 remaining files without duplicate results. Only first20 thumbnails are
shown in this minimal fixture. Full gallery/rights editing and customer CMS are incomplete.

Manufacturer JSON rows preserve source sheet/row, sport, season, SKU, quantity unit
and ADD/REPLACE uncertainty. Same row hash is staged once; changed source cells retain
both versions and require reconciliation. No source stage creates stock, models,
price mappings, or overwrites a historical season. The fixture UI covers both sports.


Review6 corrections (same approved local-fixture boundary): the ~500ms exclusive
lock acquisition budget is unchanged. A photo caller encountering contention gets
HTTP503/FIXTURE_LOCKED + Retry-After:1, and the UI instructs same-job reconciliation,
without an automatic loop or a replacement job. Tests use a real25MP synthetic PNG
and all10derivatives, followed by a deterministic test gate; this proves busy/replay
behavior, not worst-case photo latency. Offer candidates are now derived from the
same locked repository record as job creation. The browser cannot supply offers;
replays retain the original saved advisory candidate even after catalog changes.
No rights/publication, reservation or DB permission boundary changes.
