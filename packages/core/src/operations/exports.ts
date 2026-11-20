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

/** One CSV cell. Quoted when it holds a quote, comma or line break; a value a spreadsheet would run as a formula
 * (starting with = + - @, or a tab / carriage return) is prefixed with ' inside quotes so it stays text. */
export function csvCell(v:unknown):string{
 if(typeof v==='number')return Number.isFinite(v)?String(v):'';
 const s=v===null||v===undefined?'':typeof v==='boolean'?(v?'1':'0'):String(v),formula=/^[=+\-@\t\r]/.test(s);
 return formula||/[",\r\n]/.test(s)?'"'+(formula?"'":'')+s.replace(/"/g,'""')+'"':s;
}

/** UTF-8 with BOM (spreadsheet apps), CRLF, header in the staff member's display language. */
export function toCsv<R>(columns:readonly CsvColumn<R>[],rows:readonly R[],lang:CsvLang):string{
 const lines=[columns.map(c=>csvCell(lang==='en'?c.en:c.ja)).join(','),...rows.map(r=>columns.map(c=>csvCell(c.value(r))).join(','))];
 return '﻿'+lines.join('\r\n')+'\r\n';
}
