'use client';
import {useStaffLocale} from './staff-locale';
import type {useCsvDownload} from './use-csv-download';

/** "Download CSV" for a staff list, with its own failure line (a too-large export asks for narrower filters). */
export function CsvButton({csv,url,filename}:{csv:ReturnType<typeof useCsvDownload>;url:string;filename:string}){
 const {locale}=useStaffLocale(),en=locale==='en';
 return <span className="ox-csv"><button type="button" className="sx-btn" disabled={csv.busy} aria-busy={csv.busy} onClick={()=>void csv.download(url,filename)}>{en?'Download CSV':'CSVを保存'}</button>
  {csv.failed&&<span role="alert" className="sx-help ox-csv-error">{csv.failed==='EXPORT_TOO_LARGE'?(en?'Too many rows for one CSV (5,000 max). Narrow the filters.':'1つのCSVには多すぎます（上限5,000件）。条件を絞ってください。'):(en?'Could not create the CSV.':'CSVを作成できませんでした。')}</span>}</span>;
}
