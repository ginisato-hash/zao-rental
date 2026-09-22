/** Deterministic, NO-I/O activation-planning tool for provisional booking capacity (P6
 * correction). Reads the two already-committed, already-reviewed normalized capacity CSVs
 * (docs/execution/launch-critical-m2b/PROVISIONAL_SOURCE_A_CAPACITY.csv,
 * PROVISIONAL_SOURCE_B_CAPACITY.csv) and produces the exact JSON payload
 * ProvisionalCapacitySourceOperations.register() expects for each source, plus a validation
 * report cross-checking RAW and CURRENTLY MAPPED family totals against the Owner-approved
 * figures already recorded in INVENTORY_SOURCE_AUDIT.md / PROVISIONAL_SOURCE_B_AUDIT.md.
 *
 * This tool makes no network or database connection of any kind — it only reads two local files
 * and writes two local JSON files. It does not call register(), does not open a Postgres
 * connection, and is never invoked by any runtime code path. A later, separately-attended
 * activation step is expected to review this tool's own output before calling
 * ProvisionalCapacitySourceOperations.register() against a real environment; this tool does not
 * perform that call itself.
 */
import {readFileSync, writeFileSync} from 'node:fs';

type Row = {source: string; family: string; age: string; sourceSize: string; bookingSize: string | null; sizeMappingStatus: 'MAPPED' | 'UNRESOLVED'; quantity: number; unitNote: string; provenance: string};
type Payload = {sourceSha256: string; originalFilename: string; buckets: {family: string; age: string; sourceSize: string; bookingSize: string | null; quantity: number; provenance: string}[]};

const SOURCES: Record<string, {csv: string; sha256: string; originalFilename: string}> = {
  SOURCE_A: {
    csv: 'docs/execution/launch-critical-m2b/PROVISIONAL_SOURCE_A_CAPACITY.csv',
    sha256: '5ff5ce67c8ec1afbfab6bc5beeab0a2a725b73db0e1958a02860a0db39fbe1f4',
    originalFilename: '【(株)Yuge 山形蔵王】新店舗投入予定明細_20260914.xlsx',
  },
  SOURCE_B: {
    csv: 'docs/execution/launch-critical-m2b/PROVISIONAL_SOURCE_B_CAPACITY.csv',
    sha256: 'c85997f464e59c616c6afb18ce03a34f6a73371d1aebeba2a6b8229bfd9c2257',
    originalFilename: '樹林更新板25_26サロモンステーション蔵王 在庫数 (1).xlsx',
  },
};

// Minimal RFC4180-shaped CSV row parser: handles double-quoted fields with embedded commas
// (PROVISIONAL_SOURCE_A_CAPACITY.csv's own provenance column uses this for multi-row citations),
// never a naive split(',').
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { fields.push(field); field = ''; }
    else field += ch;
  }
  fields.push(field);
  return fields;
}

function readCapacityCsv(path: string): Row[] {
  const text = readFileSync(path, 'utf8').trimEnd();
  const lines = text.split('\n');
  const header = parseCsvLine(lines[0]!);
  const expected = ['source', 'family', 'age', 'source_size', 'booking_size', 'size_mapping_status', 'quantity', 'unit_note', 'provenance'];
  if (header.join(',') !== expected.join(',')) throw new Error(`UNEXPECTED_CSV_HEADER ${path}: ${header.join(',')}`);
  return lines.slice(1).map((line) => {
    const [source, family, age, sourceSize, bookingSize, csvStatus, quantity, unitNote, provenance] = parseCsvLine(line);
    // The CSV's own status column uses a richer, human-readable vocabulary (e.g.
    // BOOKING_SIZE_MAPPING_REQUIRED for Source B's ambiguous X-token buckets) than the DB's fixed
    // MAPPED/UNRESOLVED enum — ProvisionalCapacitySourceOperations.register() itself never reads a
    // status field at all; it derives MAPPED/UNRESOLVED purely from whether bookingSize is present
    // (packages/core/src/operations/provisional-capacity-source.ts). This tool matches that exactly,
    // rather than trusting the CSV's own descriptive string literally, so the two can never diverge.
    const sizeMappingStatus: Row['sizeMappingStatus'] = bookingSize ? 'MAPPED' : 'UNRESOLVED';
    if ((sizeMappingStatus === 'MAPPED') !== (csvStatus === 'MAPPED')) throw new Error(`CSV_STATUS_BOOKING_SIZE_MISMATCH ${path}: bookingSize=${JSON.stringify(bookingSize)} status=${csvStatus}`);
    return {source: source!, family: family!, age: age!, sourceSize: sourceSize!, bookingSize: bookingSize || null, sizeMappingStatus, quantity: Number(quantity), unitNote: unitNote!, provenance: provenance!};
  });
}

function payloadFor(sourceKey: keyof typeof SOURCES, rows: Row[]): Payload {
  const s = SOURCES[sourceKey]!;
  return {
    sourceSha256: s.sha256,
    originalFilename: s.originalFilename,
    buckets: rows.map((r) => ({family: r.family, age: r.age, sourceSize: r.sourceSize, bookingSize: r.bookingSize, quantity: r.quantity, provenance: r.provenance})),
  };
}

function sumBy(rows: Row[], family: string, mappedOnly: boolean): number {
  return rows.filter((r) => r.family === family && (!mappedOnly || r.sizeMappingStatus === 'MAPPED')).reduce((n, r) => n + r.quantity, 0);
}

const FAMILIES = ['SKI', 'SNOWBOARD', 'SKI_BOOT', 'SNOWBOARD_BOOT', 'WEAR_JACKET', 'WEAR_PANTS'] as const;

function main() {
  const rowsA = readCapacityCsv(SOURCES.SOURCE_A!.csv);
  const rowsB = readCapacityCsv(SOURCES.SOURCE_B!.csv);
  const payloadA = payloadFor('SOURCE_A', rowsA);
  const payloadB = payloadFor('SOURCE_B', rowsB);

  const EXPECTED_RAW: Record<string, number> = {SKI: 311, SNOWBOARD: 260, SKI_BOOT: 311, SNOWBOARD_BOOT: 309, WEAR_JACKET: 115, WEAR_PANTS: 115};
  const EXPECTED_MAPPED: Record<string, number> = {SKI: 311, SNOWBOARD: 260, SKI_BOOT: 242, SNOWBOARD_BOOT: 241, WEAR_JACKET: 115, WEAR_PANTS: 115};
  const EXPECTED_SOURCE_A: Record<string, number> = {SKI: 213, SNOWBOARD: 205, SKI_BOOT: 242, SNOWBOARD_BOOT: 241};
  const EXPECTED_SOURCE_B: Record<string, number> = {SKI: 98, SNOWBOARD: 55, SKI_BOOT: 69, SNOWBOARD_BOOT: 68, WEAR_JACKET: 115, WEAR_PANTS: 115};
  const EXPECTED_SOURCE_B_MAPPED: Record<string, number> = {SKI_BOOT: 0, SNOWBOARD_BOOT: 0};

  const failures: string[] = [];
  const check = (label: string, actual: number, expected: number) => { if (actual !== expected) failures.push(`${label}: actual=${actual} expected=${expected}`); };

  for (const family of ['SKI', 'SNOWBOARD', 'SKI_BOOT', 'SNOWBOARD_BOOT'] as const) check(`SOURCE_A raw ${family}`, sumBy(rowsA, family, false), EXPECTED_SOURCE_A[family]!);
  for (const family of FAMILIES) check(`SOURCE_B raw ${family}`, sumBy(rowsB, family, false), EXPECTED_SOURCE_B[family]!);
  for (const family of ['SKI_BOOT', 'SNOWBOARD_BOOT'] as const) check(`SOURCE_B mapped ${family}`, sumBy(rowsB, family, true), EXPECTED_SOURCE_B_MAPPED[family]!);
  for (const family of FAMILIES) check(`COMBINED raw ${family}`, sumBy(rowsA, family, false) + sumBy(rowsB, family, false), EXPECTED_RAW[family]!);
  for (const family of FAMILIES) check(`COMBINED mapped ${family}`, sumBy(rowsA, family, true) + sumBy(rowsB, family, true), EXPECTED_MAPPED[family]!);

  if (failures.length) { console.error(JSON.stringify({status: 'FAIL', failures})); process.exitCode = 1; return; }

  const outA = 'docs/execution/provisional-booking-capacity/ACTIVATION_PAYLOAD_SOURCE_A.json';
  const outB = 'docs/execution/provisional-booking-capacity/ACTIVATION_PAYLOAD_SOURCE_B.json';
  writeFileSync(outA, JSON.stringify(payloadA, null, 2) + '\n');
  writeFileSync(outB, JSON.stringify(payloadB, null, 2) + '\n');

  console.log(JSON.stringify({
    status: 'PASS',
    sourceAPath: outA, sourceABuckets: payloadA.buckets.length,
    sourceBPath: outB, sourceBBuckets: payloadB.buckets.length,
    rawTotals: Object.fromEntries(FAMILIES.map((f) => [f, sumBy(rowsA, f, false) + sumBy(rowsB, f, false)])),
    currentlyMappedTotals: Object.fromEntries(FAMILIES.map((f) => [f, sumBy(rowsA, f, true) + sumBy(rowsB, f, true)])),
    networkConnections: 0, databaseConnections: 0, productionCalls: 0,
    note: 'Output payloads are inert JSON files, not a registration call. A separate, explicitly attended step reviews and then calls ProvisionalCapacitySourceOperations.register() against a real environment.',
  }, null, 2));
}

main();
