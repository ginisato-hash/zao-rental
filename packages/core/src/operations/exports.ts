import {FlowError} from '../../../contracts/src/rental-flow';

// Booqable-style CSV export for Orders, Customers and Inventory (Issue #47, TD #7029060511 A). Each export is the screen's
// own read with the screen's own filters and the caller's current permission and stations, without paging. Columns are
// only what the screen already shows (no invented fields). An export larger than EXPORT_MAX rows is refused as a whole
// (never a silently cut file); the screen asks for narrower filters instead.
export const EXPORT_MAX=5000;
export type CsvColumn<R>={key:string;ja:string;en:string;value:(row:R)=>unknown};
export type CsvLang='ja'|'en';

export function csvLang(v:unknown):CsvLang{if(v===undefined||v===null||v==='')return 'ja';if(v!=='ja'&&v!=='en')throw new FlowError('INVALID_QUERY',422);return v;}
export function exportBound(total:number){if(total>EXPORT_MAX)throw new FlowError('EXPORT_TOO_LARGE',422);}

/** Characters a spreadsheet may treat as the start of a formula: ASCII = + - @ and their full-width forms (Excel and
 * Numbers convert ＝ ＋ － ＠ on input), plus the minus sign U+2212 and small/full-width variants (﹢ ﹣ ﹦). */
const FORMULA_START=/^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\u2212\uFE62\uFE63\uFE66]/;
/** Leading characters an importer may drop or treat as a line/field boundary before reading the rest as a formula:
 * any whitespace (ASCII, NBSP, ideographic space U+3000, line/paragraph separators) and C0/C1 control characters. */
const LEADING_SKIPPABLE=/^[\s\u0000-\u001F\u007F-\u009F\u3000\u2028\u2029\uFEFF]+/u;
/** CSV-SAFE-01: true when a text cell could be read as a formula — it starts with a formula character, or does so after
 * leading whitespace/control characters, or itself starts with a tab/CR/LF. */
export function formulaLike(s:string):boolean{return /^[\t\r\n]/.test(s)||FORMULA_START.test(s)||FORMULA_START.test(s.replace(LEADING_SKIPPABLE,''));}

/** One CSV cell. Numbers stay numbers (a negative amount is still a number). A text cell that could be read as a formula
 * (formulaLike) is prefixed with ' and quoted, so spreadsheet apps show it as text with its visible content unchanged
 * after the apostrophe. Any cell holding a quote, comma or line break is quoted with quotes doubled. Defensive escaping
 * for the common importers (Excel, Numbers, Google Sheets, LibreOffice); not a promise for every program. */
export function csvCell(v:unknown):string{
 if(typeof v==='number')return Number.isFinite(v)?String(v):'';
 const s=v===null||v===undefined?'':typeof v==='boolean'?(v?'1':'0'):String(v),formula=formulaLike(s);
 return formula||/[",\r\n]/.test(s)?'"'+(formula?"'":'')+s.replace(/"/g,'""')+'"':s;
}

/** UTF-8 with BOM (spreadsheet apps), CRLF, header in the staff member's display language. */
export function toCsv<R>(columns:readonly CsvColumn<R>[],rows:readonly R[],lang:CsvLang):string{
 const lines=[columns.map(c=>csvCell(lang==='en'?c.en:c.ja)).join(','),...rows.map(r=>columns.map(c=>csvCell(c.value(r))).join(','))];
 return '﻿'+lines.join('\r\n')+'\r\n';
}
