export const DIN_REFERENCE={version:'USC_2022_INITIAL_V1',published:'2022-12-14',accessed:'2026-10-14',url:'https://www.unionsportcycle.com/les-actualites/2022-12-14/tableau-de-reglage-des-fixations-de-ski-alpin-la-norme-iso-11088',sha256:'7e3c983c4189b85d9a294737c2208cf2dae4a3fcca208cdfcf6e6dc008567ac4'} as const;
// Functional numerical facts only. No source prose, PDF artwork or calculator code copied.
const bslUpper=[230,250,270,290,310,330,350,Infinity];
const weightUpper=[13,17,21,25,30,35,41,48,57,66,78,94,Infinity];
const heightUpper=[148,157,166,178,194,Infinity];
const values:(number|null)[][]=[
 [.75,.75,.75,null,null,null,null,null],
 [1,.75,.75,.75,null,null,null,null],
 [1.5,1.25,1.25,1,null,null,null,null],
 [2,1.75,1.5,1.5,1.25,null,null,null],
 [2.5,2.25,2,1.75,1.5,1.5,null,null],
 [3,2.75,2.5,2.25,2,1.75,1.75,null],
 [null,3.5,3,2.75,2.5,2.25,2,null],
 [null,null,3.5,3,3,2.75,2.5,null],
 [null,null,4.5,4,3.5,3.5,3,null],
 [null,null,5.5,5,4.5,4,3.5,3],
 [null,null,6.5,6,5.5,5,4.5,4],
 [null,null,7.5,7,6.5,6,5.5,5],
 [null,null,null,8.5,8,7,6.5,6],
 [null,null,null,10,9.5,8.5,8,7.5],
 [null,null,null,11.5,11,10,9.5,9],
 [null,null,null,null,null,12,11,10.5]
];
export type DinInput={heightCm:number;weightKg:number;ageAtStart:number;level:'BEGINNER'|'INTERMEDIATE'|'ADVANCED';bslMm:number};
// Owner-provided 2026-10-14 range chart, retained as a separate broad reference.
// These ranges omit height, age and actual BSL; never use them to choose a binding setting.
const ownerRanges=[
 [[.75,.75],[.75,1],[1,1.5]],[[.75,1],[1,1.5],[1.25,1.75]],[[1,1.5],[1.25,1.75],[1.5,2.25]],
 [[1.25,1.75],[1.5,2.25],[1.75,2.75]],[[1.5,2.25],[1.75,2.75],[2,3.5]],[[1.75,2.75],[2,3.5],[2.5,3.5]],
 [[2,3.5],[2.5,3.5],[3,4.5]],[[2.5,3.5],[3,4.5],[3.5,5.5]],[[3,4.5],[3.5,5.5],[4.5,6.5]],
 [[3.5,5.5],[4.5,6.5],[5.5,7.5]],[[4.5,6.5],[5.5,7.5],[6.5,8.5]],[[5.5,7.5],[6.5,8.5],[8,10]],[[6.5,8.5],[8,10],[9.5,11.5]]
];
export function weightLevelRange(weightKg:number,level:DinInput['level']){
 const row=weightUpper.findIndex(v=>weightKg<=v),column=['BEGINNER','INTERMEDIATE','ADVANCED'].indexOf(level);
 if(!Number.isFinite(weightKg)||weightKg<10||row<0||column<0||row>0&&weightKg<weightUpper[row-1]!+1)return null;
 return ownerRanges[row]?.[column]??null;
}
export type DinAdvisory={value:number|null;version:typeof DIN_REFERENCE.version;row:string|null;column:number|null;reason:'INPUT_REQUIRED'|'OUTSIDE_TABLE'|'TECHNICIAN_CHECK_REQUIRED'};
/** Initial staff reference. Never a release test or final binding setting. No foot-size input. */
export function dinAdvisory(input:DinInput|null):DinAdvisory{
 const empty={value:null,version:DIN_REFERENCE.version,row:null,column:null};
 if(!input||Object.values(input).some(v=>v===null||v===undefined))return {...empty,reason:'INPUT_REQUIRED'};
 const {heightCm,weightKg,ageAtStart,level,bslMm}=input;
 // The published bands use whole kg/cm/mm. Fractional kg in gaps are not rounded to a
 // higher release value: a technician must resolve that boundary. No extrapolation.
 if(!Number.isInteger(heightCm)||heightCm<50||heightCm>250||!Number.isFinite(weightKg)||weightKg<10||weightKg>300||!Number.isInteger(ageAtStart)||ageAtStart<0||ageAtStart>120||!Number.isInteger(bslMm)||bslMm<150||bslMm>450||!['BEGINNER','INTERMEDIATE','ADVANCED'].includes(level))return {...empty,reason:'OUTSIDE_TABLE'};
 const w=weightUpper.findIndex(v=>weightKg<=v);
 if(w>0&&weightKg<weightUpper[w-1]!+1)return {...empty,reason:'OUTSIDE_TABLE'};
 const row=Math.min(w,7+heightUpper.findIndex(v=>heightCm<=v))+['BEGINNER','INTERMEDIATE','ADVANCED'].indexOf(level)-(ageAtStart<=10||ageAtStart>=50?1:0),column=bslUpper.findIndex(v=>bslMm<=v),value=values[row]?.[column]??null;
 return {value,version:DIN_REFERENCE.version,row:row>=0&&row<values.length?String.fromCharCode(65+row):null,column,reason:value===null?'OUTSIDE_TABLE':'TECHNICIAN_CHECK_REQUIRED'};
}
