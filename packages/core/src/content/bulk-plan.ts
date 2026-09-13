import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
export class ContentInputError extends Error{constructor(public code:string){super(code);}}
export type Content={title:string;summary:string;fit_note:string};
export type Draft={offerCode:string;locale:'ja'|'en';revision:number;content:Content};
export type Target={offerCode:string;locale:'ja'|'en';expectedRevision:number;before:Content;after:Content};
export type BulkPlan={schemaVersion:'CONTENT_BULK_V1';sourceSha256:string;targets:Target[];issues:{row:number;code:string;target:string|null}[];hash:string};
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const fields=['title','summary','fit_note'] as const;
const header=['schema_version','offer_code','locale','expected_revision','field','operation','value'];
// Bounded RFC4180 parser. Neither cells nor formula-like text are executed.
export function csvRows(text:string){if(Buffer.byteLength(text)>5*1024*1024)throw new ContentInputError('CSV_TOO_LARGE');text=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const finishCell=()=>{row.push(cell);cell='';closed=false;};const finishRow=()=>{finishCell();rows.push(row);row=[];if(rows.length>1001)throw new ContentInputError('CSV_TOO_MANY_ROWS');};
 for(let n=0;n<text.length;n++){const ch=text[n]!;if(quoted){if(ch==='"'){if(text[n+1]==='"'){cell+='"';n++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
 if(ch==='"'){if(cell||closed)throw new ContentInputError('CSV_QUOTING');quoted=true;}else if(ch===',')finishCell();else if(ch==='\n')finishRow();else if(ch==='\r'){if(text[n+1]!=='\n')throw new ContentInputError('CSV_NEWLINE');n++;finishRow();}else{if(closed)throw new ContentInputError('CSV_QUOTING');cell+=ch;}}
 if(quoted)throw new ContentInputError('CSV_QUOTING');if(cell||row.length||closed)finishRow();return rows;
}
// Pure validation/planning only. A hash is correspondence evidence, not permission.
// A future server adapter must persist the plan and authorize/CAS inside its DB transaction.
export function planContentBulk(drafts:Draft[],text:string):BulkPlan{
 const rows=csvRows(text);if(rows.shift()?.join(',')!==header.join(','))throw new ContentInputError('CSV_HEADER');const current=new Map(drafts.map(d=>[d.offerCode+'/'+d.locale,d]));if(current.size!==drafts.length)throw new ContentInputError('DUPLICATE_CURRENT_TARGET');
 const targets=new Map<string,Target>(),bad=new Set<string>(),seen=new Set<string>(),issues:BulkPlan['issues']=[];
 rows.forEach((row,n)=>{let target:string|null=null;try{if(row.length!==7)throw new ContentInputError('CSV_COLUMNS');const [version,code,locale,revision,field,operation,value]=row as [string,string,string,string,string,string,string];target=code+'/'+locale;const old=current.get(target);if(version!=='1'||!old||!['ja','en'].includes(locale))throw new ContentInputError('UNKNOWN_TARGET');if(!/^[1-9][0-9]{0,9}$/.test(revision)||Number(revision)!==old.revision)throw new ContentInputError('STALE_REVISION');if(!fields.includes(field as never)||!['SET','KEEP','CLEAR'].includes(operation))throw new ContentInputError('FIELD_OR_OPERATION_FORBIDDEN');if(value.length>5000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||/<[^>]*>/.test(value))throw new ContentInputError('PLAIN_TEXT_REQUIRED');if(seen.has(target+'/'+field))throw new ContentInputError('DUPLICATE_FIELD');seen.add(target+'/'+field);if(operation==='CLEAR'&&(field==='title'||value!==''))throw new ContentInputError('CLEAR_FORBIDDEN');if(operation==='KEEP'&&value!=='')throw new ContentInputError('KEEP_VALUE_NOT_EMPTY');if(operation==='SET'&&!value.trim())throw new ContentInputError('EMPTY_SET');const proposed=targets.get(target)??{offerCode:old.offerCode,locale:old.locale,expectedRevision:old.revision,before:structuredClone(old.content),after:structuredClone(old.content)};if(operation!=='KEEP')proposed.after[field as keyof Content]=operation==='CLEAR'?'':value;targets.set(target,proposed);
 }catch(e){if(target)bad.add(target);issues.push({row:n+2,code:e instanceof ContentInputError?e.code:'INVALID_ROW',target});}});
 if(targets.size>200)throw new ContentInputError('TOO_MANY_TARGETS');const result={schemaVersion:'CONTENT_BULK_V1' as const,sourceSha256:createHash('sha256').update(text).digest('hex'),targets:[...targets].filter(([key])=>!bad.has(key)).map(([,value])=>value).sort((a,b)=>(a.offerCode+a.locale).localeCompare(b.offerCode+b.locale)),issues};return {...result,hash:digest(result)};
}
export function applyPersistedContentPlan(current:Draft[],plan:BulkPlan){const {hash,...material}=plan;if(hash!==digest(material))throw new ContentInputError('PLAN_HASH_MISMATCH');const targets=new Map(plan.targets.map(t=>[t.offerCode+'/'+t.locale,t]));if(targets.size!==plan.targets.length)throw new ContentInputError('DUPLICATE_TARGET');for(const t of targets.values()){const d=current.find(d=>d.offerCode===t.offerCode&&d.locale===t.locale);if(!d||d.revision!==t.expectedRevision||canonical(d.content)!==canonical(t.before))throw new ContentInputError('BULK_PLAN_STALE');if(Object.keys(t.after).sort().join()!==[...fields].sort().join()||!t.after.title.trim())throw new ContentInputError('CONTENT_SHAPE');}return current.map(d=>{const t=targets.get(d.offerCode+'/'+d.locale);return t?{...d,revision:d.revision+1,content:structuredClone(t.after)}:structuredClone(d);});}
// For people opening spreadsheets: literal apostrophe prefix is deliberately documented.
// Machine round-trip uses JSON, not reimporting this human export as an authority.
export function safeHumanCsv(rows:string[][]){return '\uFEFF'+rows.map(row=>row.map(cell=>{const safe=/^[\s]*[=+@-]/.test(cell)?"'"+cell:cell;return '"'+safe.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
