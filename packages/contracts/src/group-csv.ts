/**
 * GROUP_CSV_V1: pure, DB-free, HTTP-free CSV contract for invited group bookings.
 *
 * PRIVACY: every row is body data (height/weight/foot length/age) of an identifiable person and may
 * describe a minor. Treat parsed rows as personal data. This module never stores, logs or returns the
 * original file text; callers must not persist the raw upload either, only the parsed fields below.
 * No birth date, personal e-mail or card column exists by design.
 *
 * XSS: cell text (labels, sizes, anything) is preserved verbatim as inert strings. Nothing here
 * evaluates, fetches or interprets formulas/URLs/HTML. Every renderer MUST escape on output (React does
 * by default; never use dangerouslySetInnerHTML with these values).
 */
import {profileFields} from './profile-fields';
import {singleItemsCompatible} from './hold';
import {canonicalSize} from './size';
import {SKIER_TYPES,type SkierType} from './din';
import type {ItemFamily,Profile} from './recommendation';

export const GROUP_CSV_SCHEMA_VERSION='GROUP_CSV_V1' as const;
export const GROUP_CSV_MAX_BYTES=1024*1024;
export const GROUP_CSV_MAX_ROWS=100;
export const GROUP_CSV_MAX_CELL_CHARS=200;
export const GROUP_CSV_MAX_LABEL_CHARS=40;
export const GROUP_CSV_MAX_ERRORS=200;
/** Same 13-year boundary as the recommendation contract (`adultAtStart === ageAtStart >= 13`). */
export const GROUP_CSV_ADULT_MIN_AGE=13;

export type CsvLang='JA'|'EN';
export const GROUP_CSV_COLUMNS=['member_id','participant_label','sport','equipment','tier','age_at_start','height_cm','weight_kg','foot_cm','skier_type','premium_model_code','jacket_size','pants_size','wear_sport','wear_addon'] as const;
export type GroupCsvColumn=typeof GROUP_CSV_COLUMNS[number];
export type GroupCsvSport='SKI'|'SNOWBOARD'|'WEAR';
export type GroupCsvTier='REGULAR'|'PREMIUM'|'STANDARD';
export type GroupCsvEquipment={kind:'SET'}|{kind:'ITEMS';items:ItemFamily[]}|{kind:'NONE'};

/** What the caller reads from the current catalog at download/parse time. Plain data, no DB. */
export type GroupCsvCatalog={
 season:string;
 premiumModels:readonly {code:string;sport:'SKI'|'SNOWBOARD';label?:string}[];
 jacketSizes:readonly string[];
 pantsSizes:readonly string[];
 /** Optional, only for the legend: sizes per family (use {@link catalogSizesFromVariants}). */
 equipmentSizes?:Partial<Record<ItemFamily,readonly string[]>>;
};
export function catalogSizesFromVariants(variants:readonly {family:string;size:string}[]):Partial<Record<ItemFamily,string[]>>{
 const out:Partial<Record<ItemFamily,string[]>>={};
 for(const v of variants){if(!ITEM_ORDER.includes(v.family as ItemFamily))continue;const f=v.family as ItemFamily,s=canonicalSize(f,v.size);(out[f]??=[]);if(!out[f]!.includes(s))out[f]!.push(s);}
 return out;
}

/** The only fields that leave the parser. Pure personal data: see the module header. */
export type GroupCsvMemberValues={
 label:string|null;sport:GroupCsvSport;equipment:GroupCsvEquipment;tier:GroupCsvTier;
 ageAtStart:number|null;adultAtStart:boolean|null;heightCm:number|null;weightKg:number|null;footCm:number|null;
 skierType:SkierType|null;premiumModelCode:string|null;jacketSize:string|null;pantsSize:string|null;wearSport:'SKI'|'SNOWBOARD'|null;wearAddon:boolean;
};
/** `memberId` is the server-issued stable row id (null = new row). `line` is the 1-based physical CSV line. */
export type GroupCsvRow=GroupCsvMemberValues&{memberId:string|null;line:number};

export const GROUP_CSV_ERROR_CODES=[
 'FILE_TOO_LARGE','UNSUPPORTED_ENCODING','INVALID_ENCODING','AMBIGUOUS_CP932_CHAR','NUL_CHARACTER','EMPTY_FILE',
 'UNTERMINATED_QUOTE','STRAY_QUOTE','TOO_MANY_ROWS','NO_DATA_ROWS',
 'MISSING_HEADER','UNKNOWN_COLUMN','DUPLICATE_HEADER','EMPTY_HEADER',
 'ROW_CELL_COUNT_MISMATCH','CELL_TOO_LONG','CONTROL_CHARACTER',
 'REQUIRED_VALUE_MISSING','INVALID_ENUM','INVALID_MEMBER_ID','DUPLICATE_MEMBER_ID',
 'NOT_A_NUMBER','AMBIGUOUS_UNIT','HEIGHT_LOOKS_LIKE_METRES','NOT_AN_INTEGER','OUT_OF_RANGE','FOOT_PRECISION',
 'UNKNOWN_MODEL','MODEL_SPORT_MISMATCH','UNKNOWN_SIZE','UNKNOWN_ITEM','DUPLICATE_ITEM','ITEM_SPORT_MISMATCH','ITEMS_INCOMPATIBLE','SET_COMBINED',
 'PREMIUM_NOT_ALLOWED','PREMIUM_REQUIRES_ADULT','PREMIUM_MODEL_REQUIRED_ONLY_FOR_PREMIUM','TIER_NOT_ALLOWED','WEAR_FIELDS_REQUIRED',
] as const;
export const GROUP_CSV_WARNING_CODES=['EMPTY_ROW_SKIPPED','VALUE_IGNORED','DUPLICATE_LABEL','BOM_STRIPPED','ENCODING_CP932'] as const;
export type GroupCsvErrorCode=typeof GROUP_CSV_ERROR_CODES[number];
export type GroupCsvWarningCode=typeof GROUP_CSV_WARNING_CODES[number];
/** `line` is the 1-based physical line (null for whole-file errors); `column` is the stable column key or the raw header text. */
export type GroupCsvIssue<C extends string>={code:C;line:number|null;column:string|null;detail?:string|undefined};
export type GroupCsvError=GroupCsvIssue<GroupCsvErrorCode>;
export type GroupCsvWarning=GroupCsvIssue<GroupCsvWarningCode>;
export type GroupCsvParseResult={ok:true;rows:GroupCsvRow[];errors:[];warnings:GroupCsvWarning[];encoding:'UTF-8'|'CP932'}
 |{ok:false;rows:[];errors:GroupCsvError[];warnings:GroupCsvWarning[];truncated:boolean;encoding:'UTF-8'|'CP932'|null};

const ITEM_ORDER:ItemFamily[]=['SKI','SKI_BOOT','SNOWBOARD','SNOWBOARD_BOOT','POLE'];
const SPORT_ITEMS:Record<'SKI'|'SNOWBOARD',ItemFamily[]>={SKI:['SKI','SKI_BOOT','POLE'],SNOWBOARD:['SNOWBOARD','SNOWBOARD_BOOT']};

// ---------- strict alias maps (NFKC + lower-case + trim; no fuzzy matching) ----------
const nk=(s:string)=>s.normalize('NFKC').trim().toLowerCase();
const HEADERS:Record<GroupCsvColumn,{JA:string;EN:string;aliases:string[]}>={
 member_id:{JA:'メンバーID',EN:'Member ID',aliases:[]},
 participant_label:{JA:'参加者表示名',EN:'Participant label',aliases:[]},
 sport:{JA:'競技',EN:'Sport',aliases:[]},
 equipment:{JA:'用品',EN:'Equipment',aliases:[]},
 tier:{JA:'グレード',EN:'Tier',aliases:[]},
 age_at_start:{JA:'貸出開始時年齢',EN:'Age at start',aliases:[]},
 height_cm:{JA:'身長(cm)',EN:'Height (cm)',aliases:[]},
 weight_kg:{JA:'体重(kg)',EN:'Weight (kg)',aliases:[]},
 foot_cm:{JA:'足の実測長(cm)',EN:'Foot length (cm)',aliases:[]},
 skier_type:{JA:'スキーヤータイプ',EN:'Skier type',aliases:[]},
 premium_model_code:{JA:'プレミアムモデルコード',EN:'Premium model code',aliases:[]},
 jacket_size:{JA:'ジャケットサイズ',EN:'Jacket size',aliases:[]},
 pants_size:{JA:'パンツサイズ',EN:'Pants size',aliases:[]},
 wear_sport:{JA:'ウェア競技',EN:'Wear sport',aliases:[]},
 wear_addon:{JA:'ウェア追加',EN:'Add wear',aliases:[]},
};
export function groupCsvHeaderLabel(c:GroupCsvColumn,lang:CsvLang){return HEADERS[c][lang];}
const HEADER_MAP=new Map<string,GroupCsvColumn>();
for(const c of GROUP_CSV_COLUMNS){const h=HEADERS[c];for(const k of [c,h.JA,h.EN,...h.aliases]){const key=nk(k);if(HEADER_MAP.has(key)&&HEADER_MAP.get(key)!==c)throw new Error('header alias collision '+key);HEADER_MAP.set(key,c);}}

const enumMap=(pairs:Record<string,string[]>)=>{const m=new Map<string,string>();for(const [v,as] of Object.entries(pairs))for(const a of [v,...as])m.set(nk(a).replace(/[\s-]+/g,'_'),v);return m;};
const SPORTS=enumMap({SKI:['スキー'],SNOWBOARD:['スノーボード','スノボ'],WEAR:['ウェア']});
const TIERS=enumMap({REGULAR:['レギュラー'],PREMIUM:['プレミアム'],STANDARD:['スタンダード']});
const SKIER_TYPE_MAP=enumMap({TYPE_I:['I','タイプI','タイプ1','TYPE_1'],TYPE_II:['II','タイプII','タイプ2','TYPE_2'],TYPE_III:['III','タイプIII','タイプ3','TYPE_3']});
const WEAR_SPORTS=enumMap({SKI:['スキー'],SNOWBOARD:['スノーボード','スノボ']});
const YESNO=enumMap({YES:['Y','TRUE','1','はい','○'],NO:['N','FALSE','0','いいえ','×']});
const ITEMS=enumMap({SKI:['スキー板'],SKI_BOOT:['スキーブーツ'],SNOWBOARD:['スノーボード板','ボード'],SNOWBOARD_BOOT:['スノーボードブーツ','ボードブーツ'],POLE:['ポール','ストック']});
const SET_ALIASES=new Set(['set','セット']);

// ---------- encoding ----------
/** Bytes whose decoding differs between Shift_JIS variants, or characters that appear ambiguous after decoding. */
const CP932_AMBIGUOUS=/[\\~¥‾〜～＼∥‖－−￠￡￢¢£¬]/;
export function decodeGroupCsv(input:Uint8Array|string,allowCp932=true):{ok:true;text:string;encoding:'UTF-8'|'CP932';warnings:GroupCsvWarning[]}|{ok:false;error:GroupCsvError}{
 const fail=(code:GroupCsvErrorCode,detail?:string)=>({ok:false as const,error:{code,line:null,column:null,detail}});
 const warnings:GroupCsvWarning[]=[];let text:string,encoding:'UTF-8'|'CP932'='UTF-8';
 if(typeof input==='string'){if(new TextEncoder().encode(input).length>GROUP_CSV_MAX_BYTES)return fail('FILE_TOO_LARGE');text=input;}
 else{
  if(input.length>GROUP_CSV_MAX_BYTES)return fail('FILE_TOO_LARGE');
  if(input.length>=2&&((input[0]===0xff&&input[1]===0xfe)||(input[0]===0xfe&&input[1]===0xff)))return fail('UNSUPPORTED_ENCODING','UTF-16 (save as CSV UTF-8)');
  if(input.includes(0))return fail('NUL_CHARACTER');
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(input);}
  catch{
   if(!allowCp932)return fail('INVALID_ENCODING');
   try{text=new TextDecoder('shift_jis',{fatal:true,ignoreBOM:true}).decode(input);}catch{return fail('INVALID_ENCODING');}
   if(text.includes('�')||CP932_AMBIGUOUS.test(text))return fail('AMBIGUOUS_CP932_CHAR');
   encoding='CP932';warnings.push({code:'ENCODING_CP932',line:null,column:null});
  }
 }
 if(text.charCodeAt(0)===0xfeff){text=text.slice(1);warnings.push({code:'BOM_STRIPPED',line:null,column:null});}
 if(text.includes('\u0000'))return fail('NUL_CHARACTER');
 return {ok:true,text,encoding,warnings};
}

// ---------- RFC 4180 reader ----------
export type CsvRecord={line:number;cells:string[]};
/** Strict RFC4180: commas, quoted fields, "" escapes, CRLF/LF/CR terminators, newlines/commas inside quotes. */
export function readCsvRecords(text:string):{records:CsvRecord[];error?:GroupCsvError}{
 const records:CsvRecord[]=[];let cells:string[]=[],cur='',i=0,line=1,startLine=1,inQuotes=false,quoted=false,atFieldStart=true,any=false;
 const endField=()=>{cells.push(cur);cur='';quoted=false;atFieldStart=true;};
 const endRecord=()=>{endField();records.push({line:startLine,cells});cells=[];any=false;};
 while(i<text.length){
  const ch=text[i];
  if(inQuotes){
   if(ch==='"'){if(text[i+1]==='"'){cur+='"';i+=2;continue;}inQuotes=false;i++;const n=text[i];if(n!==undefined&&n!==','&&n!=='\n'&&n!=='\r')return {records,error:{code:'STRAY_QUOTE',line,column:null}};continue;}
   if(ch==='\r'&&text[i+1]==='\n'){cur+='\r\n';line++;i+=2;continue;}
   if(ch==='\n'||ch==='\r')line++;
   cur+=ch;i++;continue;
  }
  if(ch==='"'){if(!atFieldStart)return {records,error:{code:'STRAY_QUOTE',line,column:null}};inQuotes=true;quoted=true;atFieldStart=false;any=true;i++;continue;}
  if(ch===','){any=true;endField();i++;continue;}
  if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;i++;endRecord();line++;startLine=line;continue;}
  cur+=ch;atFieldStart=false;any=true;i++;
 }
 if(inQuotes)return {records,error:{code:'UNTERMINATED_QUOTE',line:startLine,column:null}};
 if(any||cur!==''||quoted||cells.length)endRecord();
 return {records};
}

// ---------- parser ----------
type Ctx={errors:GroupCsvError[];warnings:GroupCsvWarning[];truncated:boolean};
const err=(c:Ctx,code:GroupCsvErrorCode,line:number|null,column:string|null,detail?:string)=>{if(c.errors.length>=GROUP_CSV_MAX_ERRORS){c.truncated=true;return;}c.errors.push({code,line,column,detail});};
const CONTROL=/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const UNIT_LIKE=/[a-zA-Zａ-ｚＡ-Ｚ㎝㎏㎜'"′″]/;

function parseInteger(c:Ctx,raw:string,line:number,col:GroupCsvColumn,min:number,max:number):number|null{
 if(!/^\d+(\.0+)?$/.test(raw)){
  if(/^\d+(\.\d+)?e[+-]?\d+$/i.test(raw))err(c,'NOT_A_NUMBER',line,col);
  else if(UNIT_LIKE.test(raw))err(c,'AMBIGUOUS_UNIT',line,col,'remove the unit; this column is fixed');
  else if(col==='height_cm'&&/^\d+\.\d+$/.test(raw)&&Number(raw)<3)err(c,'HEIGHT_LOOKS_LIKE_METRES',line,col);
  else if(/^\d+\.\d+$/.test(raw))err(c,'NOT_AN_INTEGER',line,col);
  else err(c,'NOT_A_NUMBER',line,col);
  return null;
 }
 const n=Number(raw.replace(/\.0+$/,''));if(n<min||n>max){err(c,'OUT_OF_RANGE',line,col,min+'-'+max);return null;}return n;
}
function parseFoot(c:Ctx,raw:string,line:number):number|null{
 if(!/^\d{1,3}(\.\d*)?$/.test(raw)){err(c,UNIT_LIKE.test(raw)?'AMBIGUOUS_UNIT':'NOT_A_NUMBER',line,'foot_cm');return null;}
 if(/\.\d{2,}$/.test(raw)&&!/\.\d0+$/.test(raw)){err(c,'FOOT_PRECISION',line,'foot_cm','one decimal place');return null;}
 const n=Number(raw);if(n<5||n>50){err(c,'OUT_OF_RANGE',line,'foot_cm','5-50');return null;}return Math.round(n*10)/10;
}

export function parseGroupCsv(input:Uint8Array|string,catalog:GroupCsvCatalog,opts:{allowCp932?:boolean}={}):GroupCsvParseResult{
 const dec=decodeGroupCsv(input,opts.allowCp932??true);
 if(!dec.ok)return {ok:false,rows:[],errors:[dec.error],warnings:[],truncated:false,encoding:null};
 const c:Ctx={errors:[],warnings:[...dec.warnings],truncated:false};
 const bad=(truncated=c.truncated)=>({ok:false as const,rows:[] as [],errors:c.errors,warnings:c.warnings,truncated,encoding:dec.encoding});
 const {records,error}=readCsvRecords(dec.text);
 if(error){c.errors.push(error);return bad();}
 const head=records[0];
 if(!head){err(c,'EMPTY_FILE',null,null);return bad();}
 // header
 const colAt:(GroupCsvColumn|null)[]=[],seen=new Map<GroupCsvColumn,number>();
 head.cells.forEach((h,idx)=>{
  if(CONTROL.test(h)||h.length>GROUP_CSV_MAX_CELL_CHARS){err(c,'UNKNOWN_COLUMN',head.line,h.slice(0,40));colAt.push(null);return;}
  if(h.trim()===''){err(c,'EMPTY_HEADER',head.line,'#'+(idx+1));colAt.push(null);return;}
  const col=HEADER_MAP.get(nk(h));if(!col){err(c,'UNKNOWN_COLUMN',head.line,h);colAt.push(null);return;}
  if(seen.has(col)){err(c,'DUPLICATE_HEADER',head.line,col);colAt.push(null);return;}
  seen.set(col,idx);colAt.push(col);
 });
 for(const need of ['sport','equipment','tier'] as const)if(!seen.has(need))err(c,'MISSING_HEADER',head.line,need);
 const data=records.slice(1);
 const nonEmpty=data.filter(r=>r.cells.some(x=>x.trim()!==''));
 if(nonEmpty.length>GROUP_CSV_MAX_ROWS){err(c,'TOO_MANY_ROWS',null,null,'max '+GROUP_CSV_MAX_ROWS);return bad();}
 if(!nonEmpty.length&&!c.errors.length)err(c,'NO_DATA_ROWS',null,null);
 if(c.errors.length)return bad();

 const rows:GroupCsvRow[]=[],ids=new Map<string,number>(),labels=new Map<string,number>();
 const models=new Map(catalog.premiumModels.map(m=>[m.code.toLowerCase(),m])),jackets=new Map(catalog.jacketSizes.map(s=>[nk(s),s])),pants=new Map(catalog.pantsSizes.map(s=>[nk(s),s]));
 for(const rec of data){
  if(!rec.cells.some(x=>x.trim()!=='')){c.warnings.push({code:'EMPTY_ROW_SKIPPED',line:rec.line,column:null});continue;}
  if(rec.cells.length!==head.cells.length){err(c,'ROW_CELL_COUNT_MISMATCH',rec.line,null,rec.cells.length+' vs '+head.cells.length);continue;}
  const v:Partial<Record<GroupCsvColumn,string>>={};let cellsOk=true;
  rec.cells.forEach((cell,idx)=>{const col=colAt[idx];if(!col)return;
   const t=cell.trim();
   if([...t].length>(col==='participant_label'?GROUP_CSV_MAX_LABEL_CHARS:GROUP_CSV_MAX_CELL_CHARS)){err(c,'CELL_TOO_LONG',rec.line,col);cellsOk=false;return;}
   if(CONTROL.test(t)){err(c,'CONTROL_CHARACTER',rec.line,col);cellsOk=false;return;}
   v[col]=t;});
  if(!cellsOk)continue;
  const before=c.errors.length,L=rec.line,g=(k:GroupCsvColumn)=>v[k]??'';
  // member id (server-issued; never derived from names)
  let memberId:string|null=null;
  if(g('member_id')!==''){if(!/^[a-z0-9_-]{1,24}$/.test(g('member_id')))err(c,'INVALID_MEMBER_ID',L,'member_id');else{memberId=g('member_id');if(ids.has(memberId))err(c,'DUPLICATE_MEMBER_ID',L,'member_id','first at line '+ids.get(memberId));else ids.set(memberId,L);}}
  const label=g('participant_label')===''?null:g('participant_label');
  if(label!==null)labels.set(label,(labels.get(label)??0)+1);
  // sport / tier
  const sportRaw=SPORTS.get(nk(g('sport')).replace(/[\s-]+/g,'_'));let sport:GroupCsvSport|null=null;
  if(g('sport')==='')err(c,'REQUIRED_VALUE_MISSING',L,'sport');else if(!sportRaw)err(c,'INVALID_ENUM',L,'sport');else sport=sportRaw as GroupCsvSport;
  const ignore=(col:GroupCsvColumn)=>{if(g(col)!=='')c.warnings.push({code:'VALUE_IGNORED',line:L,column:col});};
  // equipment
  let equipment:GroupCsvEquipment={kind:'NONE'};
  if(sport&&sport!=='WEAR'){
   if(g('equipment')==='')err(c,'REQUIRED_VALUE_MISSING',L,'equipment');
   else{
    const parts=nk(g('equipment')).split(';').map(s=>s.trim());
    if(parts.length===1&&SET_ALIASES.has(parts[0]??''))equipment={kind:'SET'};
    else if(parts.some(p=>SET_ALIASES.has(p)))err(c,'SET_COMBINED',L,'equipment');
    else{
     const items:ItemFamily[]=[];let ok=true;
     for(const p of parts){const it=ITEMS.get(p.toLowerCase().replace(/[\s-]+/g,'_'));if(!it){err(c,p===''?'REQUIRED_VALUE_MISSING':'UNKNOWN_ITEM',L,'equipment',p.slice(0,40));ok=false;continue;}
      if(items.includes(it as ItemFamily)){err(c,'DUPLICATE_ITEM',L,'equipment',it);ok=false;continue;}items.push(it as ItemFamily);}
     if(ok){
      if(items.some(f=>!SPORT_ITEMS[sport as 'SKI'|'SNOWBOARD'].includes(f))){err(c,'ITEM_SPORT_MISMATCH',L,'equipment');}
      else if(!singleItemsCompatible(items)){err(c,'ITEMS_INCOMPATIBLE',L,'equipment');}
      else equipment={kind:'ITEMS',items:ITEM_ORDER.filter(f=>items.includes(f))};
     }
    }
   }
  }else if(sport==='WEAR')ignore('equipment');
  // tier
  let tier:GroupCsvTier|null=null;
  if(sport==='WEAR'){
   if(g('tier')==='')tier='STANDARD';else{const t=TIERS.get(nk(g('tier')));if(t==='STANDARD')tier='STANDARD';else err(c,t?'TIER_NOT_ALLOWED':'INVALID_ENUM',L,'tier');}
  }else if(sport){
   if(g('tier')==='')err(c,'REQUIRED_VALUE_MISSING',L,'tier');
   else{const t=TIERS.get(nk(g('tier')));if(!t)err(c,'INVALID_ENUM',L,'tier');else if(t==='STANDARD')err(c,'TIER_NOT_ALLOWED',L,'tier');else tier=t as GroupCsvTier;}
  }
  // which body fields this selection needs, from the shared contract
  const items=equipment.kind==='ITEMS'?equipment.items:undefined;
  const need=sport&&sport!=='WEAR'&&equipment.kind!=='NONE'?profileFields(sport,undefined,items):{height:false,foot:false,ski:false};
  const wearRow=sport==='WEAR';
  // age
  let ageAtStart:number|null=null;
  const boardIncluded=sport&&sport!=='WEAR'&&(equipment.kind==='SET'||(items?.includes(sport as ItemFamily)??false));
  const ageNeeded=need.ski||tier==='PREMIUM';
  if(g('age_at_start')===''){if(ageNeeded&&!wearRow)err(c,'REQUIRED_VALUE_MISSING',L,'age_at_start');}
  else ageAtStart=parseInteger(c,g('age_at_start'),L,'age_at_start',0,120);
  // height / foot / weight / skier type
  let heightCm:number|null=null,footCm:number|null=null,weightKg:number|null=null,skierType:SkierType|null=null;
  if(wearRow||(sport&&!need.height)){ignore('height_cm');}
  else if(sport){if(g('height_cm')==='')err(c,'REQUIRED_VALUE_MISSING',L,'height_cm');else heightCm=parseInteger(c,g('height_cm'),L,'height_cm',50,250);}
  if(wearRow||(sport&&!need.foot)){ignore('foot_cm');}
  else if(sport){if(g('foot_cm')==='')err(c,'REQUIRED_VALUE_MISSING',L,'foot_cm');else footCm=parseFoot(c,g('foot_cm'),L);}
  if(wearRow||(sport&&!need.ski)){ignore('weight_kg');ignore('skier_type');}
  else if(sport){
   if(g('weight_kg')==='')err(c,'REQUIRED_VALUE_MISSING',L,'weight_kg');else weightKg=parseInteger(c,g('weight_kg'),L,'weight_kg',5,300);
   if(g('skier_type')==='')err(c,'REQUIRED_VALUE_MISSING',L,'skier_type');
   else{const s=SKIER_TYPE_MAP.get(nk(g('skier_type')).replace(/[\s-]+/g,'_'));if(!s||!SKIER_TYPES.includes(s as SkierType))err(c,'INVALID_ENUM',L,'skier_type');else skierType=s as SkierType;}
  }
  // premium model
  let premiumModelCode:string|null=null;
  if(tier==='PREMIUM'){
   if(!boardIncluded)err(c,'PREMIUM_NOT_ALLOWED',L,'tier','premium needs the ski/board itself');
   if(ageAtStart!==null&&ageAtStart<GROUP_CSV_ADULT_MIN_AGE)err(c,'PREMIUM_REQUIRES_ADULT',L,'tier');
   if(g('premium_model_code')==='')err(c,'REQUIRED_VALUE_MISSING',L,'premium_model_code');
   else{const m=models.get(g('premium_model_code').toLowerCase());if(!m)err(c,'UNKNOWN_MODEL',L,'premium_model_code',g('premium_model_code').slice(0,40));else if(sport&&m.sport!==sport)err(c,'MODEL_SPORT_MISMATCH',L,'premium_model_code');else premiumModelCode=m.code;}
  }else if(g('premium_model_code')!=='')err(c,'PREMIUM_MODEL_REQUIRED_ONLY_FOR_PREMIUM',L,'premium_model_code');
  // wear
  let wearAddon=false,wearSport:'SKI'|'SNOWBOARD'|null=null,jacketSize:string|null=null,pantsSize:string|null=null;
  if(g('wear_addon')!==''){const y=YESNO.get(nk(g('wear_addon')));if(!y)err(c,'INVALID_ENUM',L,'wear_addon');else wearAddon=y==='YES';}
  if(wearRow&&g('wear_addon')!==''&&!wearAddon)err(c,'WEAR_FIELDS_REQUIRED',L,'wear_addon','a WEAR row is always wear');
  const hasWear=wearRow||wearAddon;
  if(hasWear){
   if(wearRow){if(g('wear_sport')==='')err(c,'REQUIRED_VALUE_MISSING',L,'wear_sport');}
   if(g('wear_sport')!==''){const w=WEAR_SPORTS.get(nk(g('wear_sport')).replace(/[\s-]+/g,'_'));if(!w)err(c,'INVALID_ENUM',L,'wear_sport');else wearSport=w as 'SKI'|'SNOWBOARD';}
   else if(sport==='SKI'||sport==='SNOWBOARD')wearSport=sport;
   for(const [col,map,set] of [['jacket_size',jackets,0],['pants_size',pants,1]] as const){
    if(g(col)==='')err(c,'REQUIRED_VALUE_MISSING',L,col);
    else{const s=map.get(nk(g(col)));if(!s)err(c,'UNKNOWN_SIZE',L,col,g(col).slice(0,40));else if(set===0)jacketSize=s;else pantsSize=s;}
   }
  }else{ignore('wear_sport');ignore('jacket_size');ignore('pants_size');}
  if(c.errors.length>before||c.truncated||!sport||!tier)continue;
  const adult=ageAtStart===null?null:ageAtStart>=GROUP_CSV_ADULT_MIN_AGE;
  rows.push({memberId,line:L,label,sport,equipment,tier,ageAtStart,adultAtStart:adult,heightCm,weightKg,footCm,skierType,premiumModelCode,jacketSize,pantsSize,wearSport,wearAddon:wearRow?false:wearAddon});
 }
 for(const [l,n] of labels)if(n>1)c.warnings.push({code:'DUPLICATE_LABEL',line:null,column:'participant_label',detail:l.slice(0,40)+' x'+n});
 if(c.errors.length)return bad();
 return {ok:true,rows,errors:[],warnings:c.warnings,encoding:dec.encoding};
}

// ---------- bridge to the shared recommendation contract ----------
/** Draft Profile fields derivable from CSV alone. Variant ids (poleVariantId, wearSelection, modelSelection)
 * need catalog resolution by the caller; the member key must be the server-issued id. */
export type GroupCsvProfileDraft=Pick<Profile,'key'|'sport'|'heightCm'|'footCm'|'adultAtStart'|'tier'|'ski'|'wearSport'>&{items?:ItemFamily[];premiumModelCode:string|null;jacketSize:string|null;pantsSize:string|null;needsAdultAnswer:boolean};
export function groupCsvRowToProfileDraft(row:GroupCsvMemberValues,key:string):GroupCsvProfileDraft{
 const wear=row.sport==='WEAR';
 return {key,sport:row.sport,heightCm:row.heightCm,footCm:row.footCm,adultAtStart:row.adultAtStart??false,needsAdultAnswer:row.adultAtStart===null,tier:row.tier,
  ski:row.weightKg!==null&&row.ageAtStart!==null&&row.skierType!==null?{weightKg:row.weightKg,ageAtStart:row.ageAtStart,skierType:row.skierType}:null,
  ...(wear&&row.wearSport?{wearSport:row.wearSport}:{}),...(row.equipment.kind==='ITEMS'?{items:[...row.equipment.items]}:{}),premiumModelCode:row.premiumModelCode,jacketSize:row.jacketSize,pantsSize:row.pantsSize};
}

// ---------- output: formula-injection-safe serialisation ----------
const FORMULA_START=/^[=+\-@\t\r＝＋－＠]/;
/** Cell text beginning with a formula trigger gets a leading apostrophe so spreadsheets show it as text.
 * Import never strips it (labels are preserved verbatim). Numbers are written raw, never through here. */
export function csvSafeText(s:string):string{return FORMULA_START.test(s)?"'"+s:s;}
export function csvQuote(cell:string|number|null|undefined):string{
 if(cell===null||cell===undefined)return '';
 const s=typeof cell==='number'?String(cell):csvSafeText(cell);
 return /[",\r\n]/.test(s)||s!==s.trim()?'"'+s.replace(/"/g,'""')+'"':s;
}
export function serializeCsv(table:readonly (readonly (string|number|null|undefined)[])[],bom=true):string{return (bom?'﻿':'')+table.map(r=>r.map(csvQuote).join(',')).join('\r\n')+'\r\n';}

function rowCells(r:GroupCsvRow|GroupCsvMemberValues&{memberId?:string|null}):(string|number|null)[]{
 const eq=r.equipment.kind==='SET'?'SET':r.equipment.kind==='ITEMS'?r.equipment.items.join(';'):'';
 const wear=r.sport==='WEAR';
 return [r.memberId??null,r.label,r.sport,eq,wear?null:r.tier,r.ageAtStart,r.heightCm,r.weightKg,r.footCm,r.skierType,r.premiumModelCode,r.jacketSize,r.pantsSize,r.wearSport,wear?null:r.wearAddon?'YES':null];
}
export function groupCsvHeaderRow(lang:CsvLang){return GROUP_CSV_COLUMNS.map(c=>HEADERS[c][lang]);}
/** Export current rows (for example after on-screen edits) in the same v1 layout; round-trips through the parser. */
export function serializeGroupCsvRows(rows:readonly (GroupCsvMemberValues&{memberId?:string|null})[],lang:CsvLang){return serializeCsv([groupCsvHeaderRow(lang),...rows.map(rowCells)]);}

// ---------- templates ----------
const EXAMPLE_TEXT={JA:{p:(n:number)=>'参加者'+n},EN:{p:(n:number)=>'Guest '+n}};
type Ex=Omit<GroupCsvMemberValues,'adultAtStart'>;
function exampleRows(cat:GroupCsvCatalog,lang:CsvLang):Ex[]{
 const base={label:null,tier:'REGULAR' as const,ageAtStart:null,heightCm:null,weightKg:null,footCm:null,skierType:null,premiumModelCode:null,jacketSize:null,pantsSize:null,wearSport:null,wearAddon:false};
 const p=EXAMPLE_TEXT[lang].p,jk=cat.jacketSizes[0]??null,pt=cat.pantsSizes[0]??null,out:Ex[]=[];
 out.push({...base,label:p(1),sport:'SKI',equipment:{kind:'SET'},ageAtStart:34,heightCm:172,weightKg:65,footCm:26,skierType:'TYPE_II'});
 out.push({...base,label:p(2),sport:'SNOWBOARD',equipment:{kind:'ITEMS',items:['SNOWBOARD','SNOWBOARD_BOOT']},ageAtStart:28,heightCm:165,footCm:24.5});
 const m=cat.premiumModels.find(x=>x.sport==='SKI');
 if(m)out.push({...base,label:p(3),sport:'SKI',equipment:{kind:'ITEMS',items:['SKI','SKI_BOOT']},tier:'PREMIUM',ageAtStart:41,heightCm:180,weightKg:78,footCm:27.5,skierType:'TYPE_III',premiumModelCode:m.code});
 out.push({...base,label:p(4),sport:'SKI',equipment:{kind:'SET'},ageAtStart:9,heightCm:132,weightKg:30,footCm:21,skierType:'TYPE_I',...(jk&&pt?{wearAddon:true,jacketSize:jk,pantsSize:pt,wearSport:'SKI' as const}:{})});
 if(jk&&pt)out.push({...base,label:p(5),sport:'WEAR',equipment:{kind:'NONE'},tier:'STANDARD',wearSport:'SNOWBOARD',jacketSize:jk,pantsSize:pt});
 return out;
}
type Legend={head:string[];desc:Record<GroupCsvColumn,[string,string]>;sizes:string;models:string;season:string;note:string;yes:string;no:string;cond:string};
const LEGEND_TEXT:Record<CsvLang,Legend>={
 JA:{head:['列キー','列名','必須','説明','選択肢・形式'],yes:'必須',no:'任意',cond:'条件付き',
  desc:{member_id:['任意','新規行は空欄。再importで既存行を指す場合のみ、画面/前回雛形に出た値をそのまま。名前をIDにはしません'],participant_label:['任意','番号や表示名。実名は不要（個人情報は最小限に）。40文字まで'],sport:['必須','競技'],equipment:['必須（WEARは空欄）','SET、または単品コードをセミコロン区切り'],tier:['必須（WEARは空欄可）','グレード'],age_at_start:['条件付き','貸出開始時点の年齢（整数）。スキー板を選ぶ行とPREMIUM行は必須。13歳以上を成人区分とします'],height_cm:['条件付き','cm単位の整数(50-250)。単位や小数は書かない。板/ポールを選ぶ行は必須'],weight_kg:['条件付き','kg単位の整数(5-300)。スキー板を選ぶ行のみ必須'],foot_cm:['条件付き','足の実測長 cm（靴サイズ表記ではない）。5-50、小数1桁。ブーツを選ぶ行は必須'],skier_type:['条件付き','スキー板を選ぶ行のみ必須'],premium_model_code:['条件付き','PREMIUM行のみ必須。他は空欄'],jacket_size:['条件付き','ウェアの行／ウェア追加=YESの行は必須'],pants_size:['条件付き','ウェアの行／ウェア追加=YESの行は必須'],wear_sport:['条件付き','WEAR行は必須。追加の場合は空欄なら競技と同じ'],wear_addon:['任意','WEAR行以外でウェアも借りる場合 YES。空欄=NO']},
  sizes:'カタログ上のサイズ（ダウンロード時点）',models:'プレミアムモデルコード',season:'カタログシーズン',note:'この説明ファイルはimportできません。雛形(EMPTY)またはEXAMPLEを編集してください。'},
 EN:{head:['column key','column name','required','description','allowed values / format'],yes:'required',no:'optional',cond:'conditional',
  desc:{member_id:['optional','Leave empty for new rows. Only to point at an existing row on re-import, copy the value exactly. Names are never IDs'],participant_label:['optional','Number or display name. A real name is not needed (keep personal data minimal). Up to 40 characters'],sport:['required','Sport'],equipment:['required (empty for WEAR)','SET, or single item codes separated by semicolons'],tier:['required (may be empty for WEAR)','Tier'],age_at_start:['conditional','Age at rental start (integer). Required for rows with skis and for PREMIUM rows. 13 and over is treated as adult'],height_cm:['conditional','Integer in cm (50-250). No units or decimals. Required when skis/board/poles are selected'],weight_kg:['conditional','Integer in kg (5-300). Required only when skis are selected'],foot_cm:['conditional','Measured foot length in cm (not a shoe size). 5-50, one decimal. Required when boots are selected'],skier_type:['conditional','Required only when skis are selected'],premium_model_code:['conditional','Required for PREMIUM rows only; empty otherwise'],jacket_size:['conditional','Required for WEAR rows and rows with Add wear = YES'],pants_size:['conditional','Required for WEAR rows and rows with Add wear = YES'],wear_sport:['conditional','Required for WEAR rows. For add-on wear, empty means the row sport'],wear_addon:['optional','YES if this participant also rents wear (non-WEAR rows). Empty = NO']},
  sizes:'Catalog sizes at download time',models:'Premium model codes',season:'Catalog season',note:'This guide file cannot be imported. Edit the EMPTY template or the EXAMPLE file instead.'},
};
const ENUMS:Record<GroupCsvColumn,(cat:GroupCsvCatalog)=>string>={
 sport:()=>'SKI | SNOWBOARD | WEAR',equipment:()=>'SET | '+ITEM_ORDER.join(' | ')+' (SKI: SKI, SKI_BOOT, POLE / SNOWBOARD: SNOWBOARD, SNOWBOARD_BOOT)',tier:()=>'REGULAR | PREMIUM (WEAR: STANDARD)',
 skier_type:()=>SKIER_TYPES.join(' | '),premium_model_code:c=>c.premiumModels.map(m=>m.code+'('+m.sport+')').join(' | ')||'-',
 jacket_size:c=>c.jacketSizes.join(' | ')||'-',pants_size:c=>c.pantsSizes.join(' | ')||'-',wear_sport:()=>'SKI | SNOWBOARD',wear_addon:()=>'YES | NO',
 age_at_start:()=>'0-120',height_cm:()=>'50-250',weight_kg:()=>'5-300',foot_cm:()=>'5.0-50.0',member_id:()=>'a-z 0-9 _ - (max 24)',participant_label:()=>'text',
};
export type GroupCsvTemplates={schemaVersion:typeof GROUP_CSV_SCHEMA_VERSION;lang:CsvLang;files:{empty:{filename:string;content:string};example:{filename:string;content:string};legend:{filename:string;content:string}}};
/** Three UTF-8 BOM / CRLF files (Excel friendly). `content` is a string starting with U+FEFF; encode with UTF-8. */
export function buildGroupCsvTemplates(cat:GroupCsvCatalog,lang:CsvLang):GroupCsvTemplates{
 const header=groupCsvHeaderRow(lang),ex=exampleRows(cat,lang).map(e=>rowCells({...e,adultAtStart:null,memberId:null} as GroupCsvRow));
 const T=LEGEND_TEXT[lang];
 const legend:(string|number|null)[][]=[T.head,...GROUP_CSV_COLUMNS.map(col=>[col,HEADERS[col][lang],T.desc[col][0],T.desc[col][1],ENUMS[col](cat)]),
  [],[T.season,cat.season],[T.models,...(cat.premiumModels.map(m=>m.code+' '+(m.label??'')+' ('+m.sport+')'))]];
 for(const f of ITEM_ORDER){const s=cat.equipmentSizes?.[f];if(s?.length)legend.push([T.sizes+' '+f,...s]);}
 legend.push([],[T.note]);
 return {schemaVersion:GROUP_CSV_SCHEMA_VERSION,lang,files:{
  empty:{filename:`group-guests-${lang.toLowerCase()}-empty.csv`,content:serializeCsv([header])},
  example:{filename:`group-guests-${lang.toLowerCase()}-example.csv`,content:serializeCsv([header,...ex])},
  legend:{filename:`group-guests-${lang.toLowerCase()}-guide.csv`,content:serializeCsv(legend)},
 }};
}

// ---------- re-import diff ----------
export type ImportMode='REPLACE'|'ADD';
export type GroupCsvField=keyof GroupCsvMemberValues;
/** `current` is what is on screen now; `baseline` is what the previous CSV import/server accepted for this row.
 * Without a baseline every difference is reported as a conflict (we cannot tell a screen edit from a CSV edit). */
export type ExistingGroupMember={memberId:string;current:GroupCsvMemberValues;baseline?:GroupCsvMemberValues|null};
export type FieldChange={field:GroupCsvField;from:unknown;to:unknown};
export type FieldConflict={field:GroupCsvField;baseline:unknown;current:unknown;incoming:unknown};
export type DiffConflictReason='FIELD_CONFLICT'|'UNKNOWN_MEMBER_ID'|'ID_EXISTS_IN_ADD_MODE';
export type DiffEntry=
 |{kind:'ADD';line:number;incoming:GroupCsvRow}
 |{kind:'UNCHANGED';line:number;memberId:string}
 |{kind:'CHANGE';line:number;memberId:string;changes:FieldChange[];keptScreenEdits:GroupCsvField[]}
 |{kind:'REMOVE';memberId:string;hasScreenEdits:boolean}
 |{kind:'CONFLICT';line:number;memberId:string;reason:DiffConflictReason;conflicts:FieldConflict[]};
export type GroupCsvDiff={mode:ImportMode;entries:DiffEntry[];counts:Record<'ADD'|'CHANGE'|'UNCHANGED'|'REMOVE'|'CONFLICT',number>;/** true when nothing needs a human decision */clean:boolean};
const FIELDS:GroupCsvField[]=['label','sport','equipment','tier','ageAtStart','adultAtStart','heightCm','weightKg','footCm','skierType','premiumModelCode','jacketSize','pantsSize','wearSport','wearAddon'];
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/**
 * Pure three-way diff. Never mutates input, never overwrites a screen edit: a field changed on screen AND
 * differently in the CSV is a CONFLICT entry. Entries follow CSV order, then REMOVE entries in existing order.
 * REPLACE: rows with a known member_id update that row; existing rows absent from the CSV become REMOVE; rows with
 * no member_id are ADDs. ADD: existing rows are never changed or removed; a row carrying an existing member_id is
 * a CONFLICT (ID_EXISTS_IN_ADD_MODE) and never silently merged. In both modes a member_id that is not in
 * `existing` is a CONFLICT (UNKNOWN_MEMBER_ID): ids are server-issued and never adopted from a file.
 */
export function diffGroupCsv(existing:readonly ExistingGroupMember[],incoming:readonly GroupCsvRow[],mode:ImportMode):GroupCsvDiff{
 const byId=new Map(existing.map(e=>[e.memberId,e])),entries:DiffEntry[]=[],touched=new Set<string>();
 for(const row of incoming){
  if(row.memberId===null){entries.push({kind:'ADD',line:row.line,incoming:row});continue;}
  const ex=byId.get(row.memberId);
  if(!ex){entries.push({kind:'CONFLICT',line:row.line,memberId:row.memberId,reason:'UNKNOWN_MEMBER_ID',conflicts:[]});continue;}
  if(mode==='ADD'){entries.push({kind:'CONFLICT',line:row.line,memberId:row.memberId,reason:'ID_EXISTS_IN_ADD_MODE',conflicts:[]});continue;}
  touched.add(row.memberId);
  const changes:FieldChange[]=[],conflicts:FieldConflict[]=[],kept:GroupCsvField[]=[];
  for(const f of FIELDS){
   const cur=ex.current[f],inc=row[f],base=ex.baseline?ex.baseline[f]:undefined;
   if(same(cur,inc))continue;
   if(ex.baseline){
    if(same(inc,base)){kept.push(f);continue;}              // CSV did not change it; keep the screen edit
    if(same(cur,base)){changes.push({field:f,from:cur,to:inc});continue;} // only the CSV changed it
   }
   conflicts.push({field:f,baseline:base,current:cur,incoming:inc});
  }
  if(conflicts.length)entries.push({kind:'CONFLICT',line:row.line,memberId:row.memberId,reason:'FIELD_CONFLICT',conflicts});
  else if(changes.length)entries.push({kind:'CHANGE',line:row.line,memberId:row.memberId,changes,keptScreenEdits:kept});
  else entries.push({kind:'UNCHANGED',line:row.line,memberId:row.memberId});
 }
 if(mode==='REPLACE')for(const ex of existing)if(!touched.has(ex.memberId))entries.push({kind:'REMOVE',memberId:ex.memberId,hasScreenEdits:ex.baseline?FIELDS.some(f=>!same(ex.current[f],ex.baseline![f])):true});
 const counts={ADD:0,CHANGE:0,UNCHANGED:0,REMOVE:0,CONFLICT:0};for(const e of entries)counts[e.kind]++;
 return {mode,entries,counts,clean:counts.CONFLICT===0&&!entries.some(e=>e.kind==='REMOVE'&&e.hasScreenEdits)};
}

// ---------- messages ----------
const MSG:Record<GroupCsvErrorCode,{JA:string;EN:string}>={
 FILE_TOO_LARGE:{JA:'ファイルが1MiBを超えています',EN:'File exceeds 1 MiB'},UNSUPPORTED_ENCODING:{JA:'UTF-16は読み込めません。CSV UTF-8で保存してください',EN:'UTF-16 is not supported; save as CSV UTF-8'},
 INVALID_ENCODING:{JA:'文字コードを判別できません。CSV UTF-8で保存してください',EN:'Cannot decode the file; save as CSV UTF-8'},AMBIGUOUS_CP932_CHAR:{JA:'Shift_JISで解釈が曖昧な文字（~ \\ － など）が含まれます。UTF-8で保存してください',EN:'Ambiguous Shift_JIS characters found; save as UTF-8'},
 NUL_CHARACTER:{JA:'制御文字（NUL）が含まれます',EN:'File contains NUL characters'},EMPTY_FILE:{JA:'ファイルが空です',EN:'File is empty'},
 UNTERMINATED_QUOTE:{JA:'引用符が閉じていません',EN:'Unterminated quote'},STRAY_QUOTE:{JA:'引用符の位置が不正です',EN:'Misplaced quote'},
 TOO_MANY_ROWS:{JA:'データ行が上限（100行）を超えています',EN:'More than 100 data rows'},NO_DATA_ROWS:{JA:'データ行がありません',EN:'No data rows'},
 MISSING_HEADER:{JA:'必須の列がありません',EN:'Required column missing'},UNKNOWN_COLUMN:{JA:'未知の列です',EN:'Unknown column'},DUPLICATE_HEADER:{JA:'列が重複しています',EN:'Duplicate column'},EMPTY_HEADER:{JA:'列名が空です',EN:'Empty column name'},
 ROW_CELL_COUNT_MISMATCH:{JA:'セル数がヘッダと一致しません',EN:'Cell count differs from header'},CELL_TOO_LONG:{JA:'文字数が上限を超えています',EN:'Cell too long'},CONTROL_CHARACTER:{JA:'改行・制御文字は使えません',EN:'Control characters/newlines not allowed'},
 REQUIRED_VALUE_MISSING:{JA:'必須項目が空です',EN:'Required value missing'},INVALID_ENUM:{JA:'選択肢にない値です',EN:'Value not in allowed list'},INVALID_MEMBER_ID:{JA:'メンバーIDの形式が不正です',EN:'Invalid member id'},DUPLICATE_MEMBER_ID:{JA:'メンバーIDが重複しています',EN:'Duplicate member id'},
 NOT_A_NUMBER:{JA:'半角数字の数値ではありません',EN:'Not a plain number'},AMBIGUOUS_UNIT:{JA:'単位が含まれています。列の単位（cm/kg）の数値のみ入力してください',EN:'Remove the unit; enter the number in the column unit (cm/kg)'},HEIGHT_LOOKS_LIKE_METRES:{JA:'メートルの可能性があります。cmで入力してください',EN:'Looks like metres; enter centimetres'},
 NOT_AN_INTEGER:{JA:'整数で入力してください',EN:'Integer required'},OUT_OF_RANGE:{JA:'範囲外です',EN:'Out of range'},FOOT_PRECISION:{JA:'小数1桁までです',EN:'One decimal place at most'},
 UNKNOWN_MODEL:{JA:'カタログにないモデルコードです',EN:'Model code not in catalog'},MODEL_SPORT_MISMATCH:{JA:'モデルが競技と一致しません',EN:'Model does not match sport'},UNKNOWN_SIZE:{JA:'カタログにないサイズです',EN:'Size not in catalog'},
 UNKNOWN_ITEM:{JA:'不明な用品コードです',EN:'Unknown item code'},DUPLICATE_ITEM:{JA:'用品コードが重複しています',EN:'Duplicate item code'},ITEM_SPORT_MISMATCH:{JA:'競技に合わない用品です',EN:'Item does not match sport'},ITEMS_INCOMPATIBLE:{JA:'この用品の組み合わせは選べません',EN:'Item combination not offered'},SET_COMBINED:{JA:'SETは単品と併記できません',EN:'SET cannot be combined with items'},
 PREMIUM_NOT_ALLOWED:{JA:'PREMIUMはスキー板/ボード本体を含む場合のみです',EN:'Premium needs the ski/board itself'},PREMIUM_REQUIRES_ADULT:{JA:'PREMIUMは13歳以上のみです',EN:'Premium is for age 13 and over'},PREMIUM_MODEL_REQUIRED_ONLY_FOR_PREMIUM:{JA:'モデルコードはPREMIUM行のみです',EN:'Model code only for PREMIUM rows'},
 TIER_NOT_ALLOWED:{JA:'このグレードは使えません',EN:'Tier not allowed'},WEAR_FIELDS_REQUIRED:{JA:'WEAR行のウェア追加はYES/空欄のみです',EN:'WEAR rows are always wear'},
};
/** Human-readable text for UI/route responses. Escape on render; `detail` can echo user cell text. */
export function describeGroupCsvIssue(e:GroupCsvError,lang:CsvLang){const m=MSG[e.code][lang];return (e.line!==null?(lang==='JA'?e.line+'行目':'line '+e.line)+(e.column?' / '+e.column:'')+': ':'')+m+(e.detail?' ('+e.detail+')':'');}
