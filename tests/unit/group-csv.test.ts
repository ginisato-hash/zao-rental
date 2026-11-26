import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseGroupCsv,buildGroupCsvTemplates,serializeGroupCsvRows,diffGroupCsv,readCsvRecords,csvSafeText,groupCsvRowToProfileDraft,groupCsvHeaderLabel,groupCsvHeaderRow,describeGroupCsvIssue,GROUP_CSV_COLUMNS,GROUP_CSV_MAX_BYTES,GROUP_CSV_MAX_ROWS,type GroupCsvCatalog,type GroupCsvRow,type ExistingGroupMember,type GroupCsvMemberValues} from '../../packages/contracts/src/group-csv';
import {parseRecommendation} from '../../packages/contracts/src/recommendation';

// All values below are synthetic.
const catalog:GroupCsvCatalog={season:'2026/27',premiumModels:[{code:'PSKI-A',sport:'SKI',label:'Synthetic Ski A'},{code:'PBOARD-B',sport:'SNOWBOARD'}],jacketSizes:['S','M','L'],pantsSizes:['S','M','L'],equipmentSizes:{SKI:['150 cm','160 cm'],SKI_BOOT:['25 cm','25/25.5 cm']}};
const H='sport,equipment,tier,age_at_start,height_cm,weight_kg,foot_cm,skier_type,premium_model_code,jacket_size,pants_size,wear_sport,wear_addon';
const SKI_OK='SKI,SET,REGULAR,30,170,60,26,TYPE_II,,,,,';
const csv=(...lines:string[])=>lines.join('\r\n')+'\r\n';
const parse=(s:string|Uint8Array)=>parseGroupCsv(s,catalog);
const at=<T,>(a:readonly T[],i:number):T=>{const x=a[i];assert.ok(x!==undefined,'index '+i);return x;};
const codes=(r:ReturnType<typeof parse>)=>r.errors.map(e=>e.code+'@'+e.line+(e.column?':'+e.column:''));

test('valid minimal file parses to typed rows with line numbers',()=>{
 const r=parse(csv(H,SKI_OK,'SNOWBOARD,SNOWBOARD,REGULAR,,165,,24.5,,,,,,'));
 assert.equal(r.ok,true);assert.equal(r.rows.length,2);
 assert.deepEqual([at(r.rows,0).line,at(r.rows,1).line],[2,3]);
 assert.equal(at(r.rows,0).adultAtStart,true);assert.equal(at(r.rows,1).adultAtStart,null);assert.equal(at(r.rows,1).weightKg,null);
});

test('header: JA/EN aliases, key names, any order, BOM; missing/duplicate/unknown/empty rejected with line',()=>{
 const row=['','','SKI','SET','REGULAR','30','170','60','26','TYPE_II','','','','',''];
 for(const lang of ['JA','EN'] as const){
  const hdr=GROUP_CSV_COLUMNS.map(c=>'"'+groupCsvHeaderLabel(c,lang)+'"').join(',');
  const r=parse('﻿'+csv(hdr,row.join(',')));assert.equal(r.ok,true,JSON.stringify(r.errors));
 }
 assert.equal(parse(csv('tier,sport,equipment,height_cm,foot_cm','REGULAR,SNOWBOARD,SNOWBOARD;SNOWBOARD_BOOT,170,25')).ok,true);
 assert.equal(parse(csv('sport,equipment,tier,身長（cm）,足の実測長（cm）','SNOWBOARD,SNOWBOARD,REGULAR,170,25')).ok,true); // NFKC full-width parentheses
 assert.deepEqual(codes(parse(csv('sport,tier','SKI,REGULAR'))),['MISSING_HEADER@1:equipment']);
 assert.deepEqual(codes(parse(csv('sport,equipment,tier,sport','SKI,SET,REGULAR,SKI'))),['DUPLICATE_HEADER@1:sport']);
 assert.deepEqual(codes(parse(csv('sport,equipment,Sport,tier','a,b,c,d'))),['DUPLICATE_HEADER@1:sport']);
 assert.deepEqual(codes(parse(csv(H+',dob',SKI_OK+',2000-01-01'))),['UNKNOWN_COLUMN@1:dob']);
 assert.deepEqual(codes(parse(csv('sport,equipment,tier,','SKI,SET,REGULAR,x'))),['EMPTY_HEADER@1:#4']);
 assert.deepEqual(codes(parse(csv('sport,equipment,tier,email','SKI,SET,REGULAR,a@example.test'))),['UNKNOWN_COLUMN@1:email']);
 assert.deepEqual(codes(parse(csv('sport;equipment;tier','SKI;SET;REGULAR'))),['UNKNOWN_COLUMN@1:sport;equipment;tier','MISSING_HEADER@1:sport','MISSING_HEADER@1:equipment','MISSING_HEADER@1:tier']);
});

test('encoding: UTF-8, BOM, UTF-16 and invalid bytes, CP932 strict',()=>{
 const text=csv(H,SKI_OK);
 assert.equal(parse(Buffer.from(text)).ok,true);
 const withBom=parse(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(text)]));assert.equal(withBom.ok,true);assert.ok(withBom.warnings.some(w=>w.code==='BOM_STRIPPED'));
 assert.deepEqual(codes(parse(Buffer.from([0xff,0xfe,0x73,0x00]))),['UNSUPPORTED_ENCODING@null']);
 assert.deepEqual(codes(parse(Buffer.from([0x73,0x00,0x70]))),['NUL_CHARACTER@null']);
 const mk=(label:number[])=>Buffer.concat([Buffer.from('participant_label,'+H+'\r\n'),Buffer.from(label),Buffer.from(','+SKI_OK+'\r\n')]);
 const cp=mk([0x82,0xa0]); // "あ" in CP932, invalid UTF-8
 const r=parse(cp);assert.equal(r.ok,true);assert.equal(r.encoding,'CP932');assert.equal(at(r.rows,0)?.label,'あ');
 assert.ok(r.warnings.some(w=>w.code==='ENCODING_CP932'));
 for(const amb of [[0x81,0x60],[0x82,0xa0,0x5c]])assert.deepEqual(codes(parse(mk(amb))),['AMBIGUOUS_CP932_CHAR@null']);
 assert.deepEqual(codes(parse(Buffer.from([0x82]))),['INVALID_ENCODING@null']);
 assert.deepEqual(codes(parseGroupCsv(cp,catalog,{allowCp932:false})),['INVALID_ENCODING@null']);
});

test('missing / invalid values are reported per row and column, nothing dropped silently',()=>{
 const r=parse(csv(H,
  ',SET,REGULAR,,,,,,,,,,',
  'SKI,,REGULAR,30,170,60,26,TYPE_II,,,,,',
  'SKI,SET,REGULAR,,170,60,26,TYPE_II,,,,,',
  'SKI,SET,REGULAR,30,,,26,,,,,,',
  'SKI,SET,REGULAR,30,170,60,,TYPE_II,,,,,',
  'KAYAK,SET,REGULAR,30,170,60,26,TYPE_II,,,,,',
  'SKI,SET,GOLD,30,170,60,26,TYPE_II,,,,,',
  'SKI,SET,REGULAR,30,170,60,26,TYPE_IV,,,,,'));
 assert.deepEqual(codes(r),['REQUIRED_VALUE_MISSING@2:sport','REQUIRED_VALUE_MISSING@3:equipment','REQUIRED_VALUE_MISSING@4:age_at_start','REQUIRED_VALUE_MISSING@5:height_cm','REQUIRED_VALUE_MISSING@5:weight_kg','REQUIRED_VALUE_MISSING@5:skier_type','REQUIRED_VALUE_MISSING@6:foot_cm','INVALID_ENUM@7:sport','INVALID_ENUM@8:tier','INVALID_ENUM@9:skier_type']);
 assert.equal(r.ok,false);assert.deepEqual(r.rows,[]);
});

test('number units, numeric strings, ranges, precision',()=>{
 const row=(h:string,w:string,f='26',a='30')=>`SKI,SET,REGULAR,${a},${h},${w},${f},TYPE_I,,,,,`;
 const r=parse(csv(H,row('170cm','60'),row('1.7','60'),row('1.7m','60'),row('170','60kg'),row('170','132lb'),row('170','60','26cm'),row('170','60','260'),
  row('１７０','60'),row('約170','60'),row('170','60.5'),row('170.5','60'),row('=170','60'),row('170','60','25.55'),row('49','60'),row('251','60'),row('170','4'),row('170','301'),row('170','60','26','abc'),row('1e2','60'),row('170','60','26','121')));
 assert.deepEqual(codes(r),['AMBIGUOUS_UNIT@2:height_cm','HEIGHT_LOOKS_LIKE_METRES@3:height_cm','AMBIGUOUS_UNIT@4:height_cm','AMBIGUOUS_UNIT@5:weight_kg','AMBIGUOUS_UNIT@6:weight_kg','AMBIGUOUS_UNIT@7:foot_cm','OUT_OF_RANGE@8:foot_cm','NOT_A_NUMBER@9:height_cm','NOT_A_NUMBER@10:height_cm','NOT_AN_INTEGER@11:weight_kg','NOT_AN_INTEGER@12:height_cm','NOT_A_NUMBER@13:height_cm','FOOT_PRECISION@14:foot_cm','OUT_OF_RANGE@15:height_cm','OUT_OF_RANGE@16:height_cm','OUT_OF_RANGE@17:weight_kg','OUT_OF_RANGE@18:weight_kg','AMBIGUOUS_UNIT@19:age_at_start','NOT_A_NUMBER@20:height_cm','OUT_OF_RANGE@21:age_at_start']);
 assert.equal(parse(csv(H,row('170.0','60.0','26.0'))).ok,true);
});

test('unknown model, wrong-sport model, premium rules, unknown size, items',()=>{
 const r=parse(csv(H,
  'SKI,SET,PREMIUM,30,170,60,26,TYPE_II,NOPE,,,,',
  'SKI,SET,PREMIUM,30,170,60,26,TYPE_II,PBOARD-B,,,,',
  'SKI,SET,PREMIUM,30,170,60,26,TYPE_II,,,,,',
  'SKI,SET,REGULAR,30,170,60,26,TYPE_II,PSKI-A,,,,',
  'SKI,SET,PREMIUM,12,170,60,26,TYPE_II,PSKI-A,,,,',
  'SKI,SKI_BOOT,PREMIUM,30,,,26,,PSKI-A,,,,',
  'WEAR,,STANDARD,,,,,,,XXL,M,SKI,',
  'SKI,SET;POLE,REGULAR,30,170,60,26,TYPE_II,,,,,',
  'SKI,SNOWBOARD,REGULAR,30,170,60,26,TYPE_II,,,,,',
  'SKI,SKI;SKI,REGULAR,30,170,60,26,TYPE_II,,,,,',
  'SKI,GLOVES,REGULAR,30,170,60,26,TYPE_II,,,,,',
  'SKI,SKI;SKI_BOOT;POLE,STANDARD,30,170,60,26,TYPE_II,,,,,'));
 assert.deepEqual(codes(r),['UNKNOWN_MODEL@2:premium_model_code','MODEL_SPORT_MISMATCH@3:premium_model_code','REQUIRED_VALUE_MISSING@4:premium_model_code','PREMIUM_MODEL_REQUIRED_ONLY_FOR_PREMIUM@5:premium_model_code','PREMIUM_REQUIRES_ADULT@6:tier','PREMIUM_NOT_ALLOWED@7:tier','UNKNOWN_SIZE@8:jacket_size','SET_COMBINED@9:equipment','ITEM_SPORT_MISMATCH@10:equipment','DUPLICATE_ITEM@11:equipment','UNKNOWN_ITEM@12:equipment','TIER_NOT_ALLOWED@13:tier']);
});

test('WEAR-only rows may leave unneeded columns empty; ignored values are warned, not silent',()=>{
 const r=parse(csv(H,'WEAR,,,,,,,,,M,L,SNOWBOARD,','WEAR,SET,STANDARD,,170,60,26,TYPE_I,,M,L,SKI,'));
 assert.equal(r.ok,true);assert.equal(at(r.rows,0).tier,'STANDARD');assert.equal(at(r.rows,0).heightCm,null);
 assert.deepEqual(r.warnings.filter(w=>w.code==='VALUE_IGNORED').map(w=>w.line+':'+w.column),['3:equipment','3:height_cm','3:foot_cm','3:weight_kg','3:skier_type']);
 assert.deepEqual(codes(parse(csv(H,'WEAR,,,,,,,,,M,L,,'))),['REQUIRED_VALUE_MISSING@2:wear_sport']);
 assert.deepEqual(codes(parse(csv(H,'WEAR,,,,,,,,,,,SKI,'))),['REQUIRED_VALUE_MISSING@2:jacket_size','REQUIRED_VALUE_MISSING@2:pants_size']);
});

test('only what the selection needs is required: snowboard / boots / poles need no weight, age or skier type',()=>{
 assert.equal(parse(csv(H,'SKI,SKI,REGULAR,40,170,70,,TYPE_I,,,,,')).ok,true); // ski alone needs no foot
 assert.equal(parse(csv(H,'SNOWBOARD,SNOWBOARD;SNOWBOARD_BOOT,REGULAR,,170,,25,,,,,,','SKI,SKI_BOOT,REGULAR,,,,25,,,,,,','SKI,POLE,REGULAR,,170,,,,,,,,')).ok,true);
 assert.deepEqual(codes(parse(csv(H,'SKI,SKI_BOOT,REGULAR,,170,,,,,,,,'))),['REQUIRED_VALUE_MISSING@2:foot_cm']);
 const w=parse(csv(H,'SNOWBOARD,SNOWBOARD,REGULAR,,170,70,,TYPE_I,,,,,')); // weight/skier type on a board row: warned and dropped
 assert.equal(w.ok,true);assert.equal(at(w.rows,0).weightKg,null);assert.equal(w.warnings.length,2);
});

test('wear add-on flag and default wear sport',()=>{
 const r=parse(csv(H,'SKI,SET,REGULAR,30,170,60,26,TYPE_II,,M,L,,YES','SNOWBOARD,SNOWBOARD,REGULAR,,170,,,,,m,l,,はい'));
 assert.equal(r.ok,true);assert.equal(at(r.rows,0).wearAddon,true);assert.equal(at(r.rows,0).wearSport,'SKI');assert.equal(at(r.rows,1).wearSport,'SNOWBOARD');assert.equal(at(r.rows,1).jacketSize,'M');
 assert.deepEqual(codes(parse(csv(H,'SKI,SET,REGULAR,30,170,60,26,TYPE_II,,,,,YES'))),['REQUIRED_VALUE_MISSING@2:jacket_size','REQUIRED_VALUE_MISSING@2:pants_size']);
 assert.deepEqual(codes(parse(csv(H,'SKI,SET,REGULAR,30,170,60,26,TYPE_II,,,,,maybe'))),['INVALID_ENUM@2:wear_addon']);
});

test('duplicate ids, same-name participants, id format',()=>{
 const hh='member_id,participant_label,'+H;
 const r=parse(csv(hh,'m-1,Taro,'+SKI_OK,'m-2,Taro,'+SKI_OK,'m-1,Hanako,'+SKI_OK,'M_3!,X,'+SKI_OK));
 assert.deepEqual(codes(r),['DUPLICATE_MEMBER_ID@4:member_id','INVALID_MEMBER_ID@5:member_id']);
 const same=parse(csv(hh,',Taro,'+SKI_OK,',Taro,'+SKI_OK));assert.equal(same.ok,true);assert.equal(same.rows.length,2);assert.ok(same.warnings.some(w=>w.code==='DUPLICATE_LABEL'));
 assert.deepEqual(same.rows.map(x=>x.line),[2,3]);assert.deepEqual(same.rows.map(x=>x.memberId),[null,null]);
});

test('RFC4180: quotes, CRLF/LF/CR, embedded newline/comma, escaped quotes, errors',()=>{
 assert.deepEqual(readCsvRecords('a,"b,c","d""e"\r\n"x\r\ny",z\n1,2\r').records,[{line:1,cells:['a','b,c','d"e']},{line:2,cells:['x\r\ny','z']},{line:4,cells:['1','2']}]);
 assert.equal(readCsvRecords('a,"b').error?.code,'UNTERMINATED_QUOTE');
 assert.equal(readCsvRecords('a,b"c').error?.code,'STRAY_QUOTE');
 assert.equal(readCsvRecords('a,"b"c').error?.code,'STRAY_QUOTE');
 const hh='participant_label,'+H;
 assert.equal(parse(csv(hh,'"Smith, ""J"" Jr.",'+SKI_OK)).rows[0]?.label,'Smith, "J" Jr.');
 assert.deepEqual(codes(parse(csv(hh,'"two\nlines",'+SKI_OK))),['CONTROL_CHARACTER@2:participant_label']);
 assert.equal(parse(hh+'\n'+'x,'+SKI_OK+'\n').ok,true); // LF only
 assert.equal(parse(hh+'\r'+'x,'+SKI_OK+'\r').ok,true); // CR only
 assert.deepEqual(codes(parse(csv(hh,'a,'+SKI_OK,'b,SKI,SET'))),['ROW_CELL_COUNT_MISMATCH@3']);
 const two=parse(csv(hh,'"a\r\nb",'+SKI_OK,'x,BAD,SET,REGULAR,30,170,60,26,TYPE_II,,,,,')); // physical line numbers include embedded newlines
 assert.deepEqual(codes(two),['CONTROL_CHARACTER@2:participant_label','INVALID_ENUM@4:sport']);
});

test('blank rows are skipped with a warning; empty / header-only files fail',()=>{
 const r=parse(csv(H,SKI_OK,',,,,,,,,,,,,',SKI_OK));assert.equal(r.ok,true);assert.equal(r.rows.length,2);assert.deepEqual(r.warnings.filter(w=>w.code==='EMPTY_ROW_SKIPPED').map(w=>w.line),[3]);
 assert.deepEqual(codes(parse('')),['EMPTY_FILE@null']);
 assert.deepEqual(codes(parse(csv(H))),['NO_DATA_ROWS@null']);
});

test('limits: 1 MiB, cell length, 1/20/21/50/100 rows ok, 101 rejected, all-or-nothing',()=>{
 assert.equal(GROUP_CSV_MAX_BYTES,1048576);assert.equal(GROUP_CSV_MAX_ROWS,100);
 assert.deepEqual(codes(parse(Buffer.alloc(GROUP_CSV_MAX_BYTES+1,97))),['FILE_TOO_LARGE@null']);
 assert.deepEqual(codes(parse('x'.repeat(GROUP_CSV_MAX_BYTES+1))),['FILE_TOO_LARGE@null']);
 const hh='participant_label,'+H;
 assert.deepEqual(codes(parse(csv(hh,'x'.repeat(41)+','+SKI_OK))),['CELL_TOO_LONG@2:participant_label']);
 assert.equal(parse(csv(hh,'x'.repeat(40)+','+SKI_OK)).ok,true);
 assert.deepEqual(codes(parse(csv(H,'SKI,SET,REGULAR,30,170,60,26,TYPE_II,'+'z'.repeat(201)+',,,,'))),['CELL_TOO_LONG@2:premium_model_code']);
 for(const n of [1,20,21,50,100]){const r=parse(csv(H,...Array(n).fill(SKI_OK)));assert.equal(r.ok,true,String(n));assert.equal(r.rows.length,n);}
 const over=parse(csv(H,...Array(101).fill(SKI_OK)));assert.equal(over.ok,false);assert.deepEqual(codes(over),['TOO_MANY_ROWS@null']);assert.deepEqual(over.rows,[]);
 assert.equal(parse(csv(H,...Array(100).fill(SKI_OK),...Array(50).fill(',,,,,,,,,,,,'))).ok,true); // blank padding is not counted
 const many=parse(csv(H,...Array(100).fill('SKI,SET,REGULAR,x,x,x,x,x,,,,,')));
 assert.equal(many.ok,false);assert.equal(many.ok===false&&many.truncated,true);assert.equal(many.errors.length,200);
});

test('formulas, URLs and HTML in cells are preserved as inert text, never interpreted',()=>{
 const hh='participant_label,'+H;
 const evil=['=HYPERLINK("http://evil.test","x")','+1+1','-2+3','@SUM(1)','<script>alert(1)</script>','http://e.test/?<img src=x onerror=1>'];
 const r=parse(csv(hh,...evil.map(e=>'"'+e.replace(/"/g,'""')+'",'+SKI_OK)));
 assert.equal(r.ok,true);assert.deepEqual(r.rows.map(x=>x.label),evil);
 assert.deepEqual(codes(parse(csv(H,'SKI,SET,REGULAR,30,=1+1,60,26,TYPE_II,,,,,'))),['NOT_A_NUMBER@2:height_cm']);
 assert.deepEqual(codes(parse(csv(H,'<b>SKI</b>,SET,REGULAR,30,170,60,26,TYPE_II,,,,,'))),['INVALID_ENUM@2:sport']);
});

test('output escapes formula triggers; apostrophe-prefixed text round-trips verbatim',()=>{
 for(const s of ['=1+1','+1','-1','@x','\tx','\rx','＝1'])assert.equal(csvSafeText(s),"'"+s);
 assert.equal(csvSafeText('safe'),'safe');
 const row:GroupCsvMemberValues&{memberId:string|null}={memberId:null,label:'=HYPERLINK("x")',sport:'SKI',equipment:{kind:'SET'},tier:'REGULAR',ageAtStart:30,adultAtStart:true,heightCm:170,weightKg:60,footCm:26,skierType:'TYPE_II',premiumModelCode:null,jacketSize:null,pantsSize:null,wearSport:null,wearAddon:false};
 const out=serializeGroupCsvRows([row,{...row,label:'-5, "q"'},{...row,label:'+x'}],'EN');
 assert.ok(out.startsWith('﻿'));
 const lines=out.split('\r\n');
 assert.ok(at(lines,1).startsWith(',"\'=HYPERLINK(""x"")",'));
 assert.ok(at(lines,2).startsWith(',"\'-5, ""q""",'));
 assert.ok(at(lines,3).startsWith(",'+x,"));
 const back=parse(out);assert.equal(back.ok,true);assert.equal(at(back.rows,0).label,"'=HYPERLINK(\"x\")");
});

test('templates: JA/EN empty, example, legend; BOM; round trip with zero errors',()=>{
 for(const lang of ['JA','EN'] as const){
  const t=buildGroupCsvTemplates(catalog,lang);
  for(const f of Object.values(t.files)){assert.ok(f.content.startsWith('﻿'));assert.ok(f.content.includes('\r\n'));assert.ok(/\.csv$/.test(f.filename));}
  assert.deepEqual(t.files.empty.content,'﻿'+groupCsvHeaderRow(lang).join(',')+'\r\n');
  assert.deepEqual(codes(parse(t.files.empty.content)),['NO_DATA_ROWS@null']);
  const ex=parse(Buffer.from(t.files.example.content,'utf8'));assert.equal(ex.ok,true,JSON.stringify(ex.errors));
  assert.equal(ex.warnings.filter(w=>w.code!=='BOM_STRIPPED').length,0);
  assert.ok(ex.rows.length>=5);assert.ok(ex.rows.some(x=>x.tier==='PREMIUM'&&x.premiumModelCode==='PSKI-A'));assert.ok(ex.rows.some(x=>x.sport==='WEAR'));assert.ok(ex.rows.some(x=>x.wearAddon));assert.ok(ex.rows.some(x=>(x.ageAtStart??99)<13));
  assert.notEqual(t.files.example.content,t.files.empty.content);
  for(const tok of ['PSKI-A','PBOARD-B','2026/27','25/25.5 cm','TYPE_III','S | M | L'])assert.ok(t.files.legend.content.includes(tok),tok);
  assert.notEqual(parse(t.files.legend.content).ok,true);
  const again=parse(serializeGroupCsvRows(ex.rows,lang));assert.equal(again.ok,true);
  assert.deepEqual(again.rows.map(x=>({...x,line:0})),ex.rows.map(x=>({...x,line:0})));
 }
 const bare:GroupCsvCatalog={season:'x',premiumModels:[],jacketSizes:[],pantsSizes:[]};
 assert.equal(parse(buildGroupCsvTemplates(bare,'EN').files.example.content).ok,true);
 const hostile:GroupCsvCatalog={...catalog,premiumModels:[{code:'=X',sport:'SKI',label:'-y'}]};
 assert.ok(!buildGroupCsvTemplates(hostile,'EN').files.legend.content.split('\r\n').some(l=>/^[=+@-]/.test(l.replace(/^﻿/,''))));
 assert.ok(buildGroupCsvTemplates(hostile,'EN').files.legend.content.includes("'=X"));
});

test('rows match the shared recommendation contract (13-year boundary, field requirements)',()=>{
 const r=parse(csv(H,'SKI,SET,REGULAR,13,170,60,26,TYPE_II,,,,,','SKI,SET,REGULAR,12,140,35,23,TYPE_I,,,,,','SNOWBOARD,SNOWBOARD;SNOWBOARD_BOOT,REGULAR,,165,,24.5,,,,,,','SKI,SKI;SKI_BOOT,PREMIUM,45,180,80,27,TYPE_III,PSKI-A,,,,'));
 assert.equal(r.ok,true);
 const members=r.rows.map((row,i)=>{const d=groupCsvRowToProfileDraft(row,'m'+i);
  const m:Record<string,unknown>={key:d.key,sport:d.sport,heightCm:d.heightCm,footCm:d.footCm,adultAtStart:d.needsAdultAnswer?true:d.adultAtStart,tier:d.tier,ski:d.ski,poleVariantId:null};
  if(d.items)m.items=d.items;if(d.tier==='PREMIUM')m.modelSelection={modelId:randomUUID(),season:'2026/27'};return m;});
 const input=(ms:Record<string,unknown>[],v:'INTEGRATED_V1_3'|'INTEGRATED_V1_4')=>({contractVersion:v,pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:v==='INTEGRATED_V1_4'?{startDate:'2027-01-10',endDate:'2027-01-10',slot:'DAY',startAt:'08:30',returnBy:'17:00'}:{startDate:'2027-01-10',endDate:'2027-01-10',slot:'DAY'},members:ms});
 assert.doesNotThrow(()=>parseRecommendation(input(members.slice(0,2),'INTEGRATED_V1_3')));
 assert.doesNotThrow(()=>parseRecommendation(input(members.slice(2),'INTEGRATED_V1_4')));
 assert.throws(()=>parseRecommendation(input([{...members[1],adultAtStart:true}],'INTEGRATED_V1_3')));
 assert.throws(()=>parseRecommendation(input([{...members[0],adultAtStart:false}],'INTEGRATED_V1_3')));
 assert.equal(at(r.rows,0).adultAtStart,true);assert.equal(at(r.rows,1).adultAtStart,false);
 assert.equal(groupCsvRowToProfileDraft(at(r.rows,2),'k').needsAdultAnswer,true);
});

test('messages exist in both languages with row/column prefix',()=>{
 const r=parse(csv(H,'SKI,SET,REGULAR,x,170,60,26,TYPE_II,,,,,'));
 assert.equal(describeGroupCsvIssue(at(r.errors,0),'JA').startsWith('2行目 / age_at_start'),true);
 assert.equal(describeGroupCsvIssue(at(r.errors,0),'EN').startsWith('line 2 / age_at_start'),true);
});

// ---------- re-import diff ----------
const vals=(o:Partial<GroupCsvMemberValues>={}):GroupCsvMemberValues=>({label:'A',sport:'SKI',equipment:{kind:'SET'},tier:'REGULAR',ageAtStart:30,adultAtStart:true,heightCm:170,weightKg:60,footCm:26,skierType:'TYPE_II',premiumModelCode:null,jacketSize:null,pantsSize:null,wearSport:null,wearAddon:false,...o});
const inc=(memberId:string|null,line:number,o:Partial<GroupCsvMemberValues>={}):GroupCsvRow=>({memberId,line,...vals(o)});
const ex=(memberId:string,current:Partial<GroupCsvMemberValues>={},baseline?:Partial<GroupCsvMemberValues>|null):ExistingGroupMember=>({memberId,current:vals(current),baseline:baseline===null?null:vals(baseline??current)});

test('diff REPLACE: add/change/unchanged/remove keep ids and input order, names are not ids',()=>{
 const d=diffGroupCsv([ex('m1'),ex('m2'),ex('m3')],[inc('m2',2,{heightCm:175}),inc(null,3,{label:'A'}),inc('m1',4)],'REPLACE');
 assert.deepEqual(d.entries.map(e=>e.kind+':'+('memberId' in e?e.memberId:'new')),['CHANGE:m2','ADD:new','UNCHANGED:m1','REMOVE:m3']);
 assert.deepEqual(d.counts,{ADD:1,CHANGE:1,UNCHANGED:1,REMOVE:1,CONFLICT:0});
 const c=at(d.entries,0);assert.ok(c.kind==='CHANGE'&&c.changes.length===1&&c.changes[0]?.field==='heightCm'&&c.changes[0]?.from===170&&c.changes[0]?.to===175);
 assert.equal(d.clean,true);
});

test('diff never overwrites screen edits: conflicts are returned, non-conflicting CSV changes apply',()=>{
 const base={heightCm:170,weightKg:60};
 const existing=[ex('m1',{heightCm:172,weightKg:60},base)]; // someone edited height on screen
 let d=diffGroupCsv(existing,[inc('m1',2,base)],'REPLACE');
 assert.equal(at(d.entries,0).kind,'UNCHANGED'); // CSV did not touch it: the screen edit stays
 d=diffGroupCsv(existing,[inc('m1',2,{heightCm:180,weightKg:60})],'REPLACE');
 const e=at(d.entries,0);assert.ok(e.kind==='CONFLICT'&&e.reason==='FIELD_CONFLICT');
 if(e.kind==='CONFLICT')assert.deepEqual(e.conflicts,[{field:'heightCm',baseline:170,current:172,incoming:180}]);
 assert.equal(d.clean,false);
 d=diffGroupCsv(existing,[inc('m1',2,{heightCm:170,weightKg:65})],'REPLACE');
 const c=at(d.entries,0);assert.ok(c.kind==='CHANGE'&&c.changes[0]?.field==='weightKg'&&c.keptScreenEdits.includes('heightCm'));
 d=diffGroupCsv(existing,[inc('m1',2,{heightCm:172,weightKg:60})],'REPLACE');assert.equal(at(d.entries,0).kind,'UNCHANGED');
 d=diffGroupCsv([ex('m1',{heightCm:172},null)],[inc('m1',2,{heightCm:180})],'REPLACE');assert.equal(at(d.entries,0).kind,'CONFLICT'); // no baseline: never guess
 assert.equal(existing[0]?.current.heightCm,172); // input not mutated
});

test('diff ADD mode: never changes or removes existing rows; known id and foreign id are conflicts',()=>{
 const existing=[ex('m1'),ex('m2')];
 const d=diffGroupCsv(existing,[inc(null,2),inc('m1',3,{heightCm:199}),inc('zz9',4)],'ADD');
 assert.deepEqual(d.entries.map(e=>e.kind),['ADD','CONFLICT','CONFLICT']);
 assert.deepEqual(d.entries.flatMap(e=>e.kind==='CONFLICT'?[e.reason]:[]),['ID_EXISTS_IN_ADD_MODE','UNKNOWN_MEMBER_ID']);
 assert.equal(d.counts.REMOVE,0);assert.equal(d.clean,false);
 assert.deepEqual(diffGroupCsv(existing,[inc('zz9',2)],'REPLACE').entries.map(e=>e.kind),['CONFLICT','REMOVE','REMOVE']);
});

test('diff REMOVE of a screen-edited row is flagged and makes the diff not clean',()=>{
 const d=diffGroupCsv([ex('m1',{heightCm:172},{heightCm:170}),ex('m2')],[],'REPLACE');
 assert.deepEqual(d.entries.map(e=>e.kind==='REMOVE'&&e.hasScreenEdits),[true,false]);assert.equal(d.clean,false);
 assert.equal(diffGroupCsv([ex('m2')],[],'REPLACE').clean,true);
 const nb=at(diffGroupCsv([ex('m3',{},null)],[],'REPLACE').entries,0);assert.ok(nb.kind==='REMOVE'&&nb.hasScreenEdits);
});

test('equipment item order in the cell does not matter',()=>{
 const a=parse(csv(H,'SKI,POLE;SKI_BOOT;SKI,REGULAR,30,170,60,26,TYPE_I,,,,,')),b=parse(csv(H,'SKI,SKI;SKI_BOOT;POLE,REGULAR,30,170,60,26,TYPE_I,,,,,'));
 assert.deepEqual(at(a.rows,0).equipment,at(b.rows,0).equipment);
});
