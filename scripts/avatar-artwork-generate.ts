import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {validAvatarRaster} from '../packages/core/src/avatar/media';

// Owner-authorized local illustration, not image-model output or a product photograph.
// The source-only PNGs stay outside Git. Hashes bind the supplied visual references.
const sourceRoot=resolve(process.argv[2]??'../avatar-artwork-intake/sources');
const root='docs/execution/avatar-artwork-activation/artwork';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const sources=[
 ['1.png','ea7b76e53d920f7443c88ae7cd1e55acf272ef89527aaf233091a87e54044ca9'],
 ['2.png','4c03ae11fc76eac3164d0754bbf45c0aeacf2eac03fb6dc2ab85df5fb84e407d'],
 ['3.png','5a9ccc7893c91deebea917281783b5ddb7f794581fa5016325edc5f33b0fb120'],
 ['4.png','0fb84d84af77013c71c0e71ac4e1010dc94690faede7447e7815193a3afdc04a'],
 ['5.png','5c4485861c80d88bcd8a37dd4394f7cdea63218f163699442c8edd48fe265dca'],
 ['6.png','6e13ca996ce652d81b82105568d6ca6ef4d5ad0ad8b26dc0a1789e0a81953c84'],
] as const;
for(const [file,hash] of sources)if(digest(await readFile(resolve(sourceRoot,file)))!==hash)throw new Error('OWNER_SOURCE_HASH_MISMATCH');
const authoritySha256=digest(await readFile('docs/execution/AVATAR_PHASE5_ARTWORK_AUTHORITY.md'));
if(authoritySha256!=='f99a96733aedf0214f31d5c02502e60909835a577248d1922caf71449a1edaab')throw new Error('OWNER_AUTHORITY_MISMATCH');
function body(base:string,light:string,dark:string,pants:string,pantsLight:string){return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2000" viewBox="0 0 400 1000">
<defs><linearGradient id="j" x1="0" x2="1"><stop stop-color="${dark}"/><stop offset=".32" stop-color="${base}"/><stop offset=".7" stop-color="${light}"/><stop offset="1" stop-color="${base}"/></linearGradient><linearGradient id="p" x1="0" x2="1"><stop stop-color="${pants}"/><stop offset=".5" stop-color="${pantsLight}"/><stop offset="1" stop-color="${pants}"/></linearGradient></defs>
<path d="M174 118H226V168H174Z" fill="#b99679"/>
<path d="M154 55Q151 26 173 15Q198 5 225 15Q249 27 246 57L242 99Q235 126 216 138Q200 146 184 137Q165 124 158 101Z" fill="#d6b698"/>
<path d="M159 77Q163 119 184 132L181 113L169 99L166 72Z" fill="#bd987c"/>
<path d="M200 0C166 0 148 25 149 64L153 76Q176 57 200 58Q225 57 247 76L251 62C252 25 232 0 200 0Z" fill="#253333"/>
<path d="M200 6Q171 7 160 34L157 54Q178 43 199 44Q223 43 243 57L241 41Q230 9 200 6Z" fill="#394b48"/>
<path d="M179 84H187M213 84H221" stroke="#3c3b36" stroke-width="3" stroke-linecap="round"/>
<path d="M200 84L196 101L204 102M188 117Q200 123 212 117" fill="none" stroke="#997b64" stroke-width="2.5" stroke-linecap="round"/>
<path d="M170 146L148 140L121 154Q105 164 98 191L68 341L51 494Q49 518 64 522L83 516L108 373L127 296L137 504H263L273 296L292 373L317 516L336 522Q351 518 349 494L332 341L302 191Q295 164 279 154L252 140L230 146Z" fill="url(#j)" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>
<path d="M53 492L48 531Q48 546 58 550L76 544L86 511Z M347 492L352 531Q352 546 342 550L324 544L314 511Z" fill="#293637"/>
<path d="M58 504L53 531Q52 540 58 542M342 504L347 531Q348 540 342 542" fill="none" stroke="#50615e" stroke-width="3"/>
<path d="M123 179L104 338L86 472L75 469L91 338L110 193Z M277 179L296 338L314 472L325 469L309 338L290 193Z" fill="${dark}" opacity=".55"/>
<path d="M138 308L132 404L139 504H261L268 404L262 308L247 349L245 489H155L153 349Z" fill="${dark}" opacity=".25"/>
<path d="M164 137L180 128Q200 148 220 128L236 137L227 196L200 208L173 196Z" fill="${dark}"/>
<path d="M168 143L179 146L184 184L195 200L174 190Z M232 143L221 146L216 184L205 200L226 190Z" fill="${light}"/>
<path d="M200 203V501" stroke="#39413b" stroke-width="4"/>
<path d="M204 210V491" stroke="${light}" stroke-width="2" opacity=".7"/>
<rect x="198" y="221" width="5" height="13" rx="2" fill="#202c2c"/>
<path d="M146 256L177 250M149 263L176 257M143 366L159 418M257 366L241 418" stroke="${dark}" stroke-width="4" stroke-linecap="round"/>
<path d="M150 254L177 249M146 364L162 413M254 364L238 413" fill="none" stroke="${light}" stroke-width="2" opacity=".7"/>
<path d="M132 492Q200 504 268 492L264 536L216 548H184L136 536Z" fill="${pants}"/>
<path d="M137 521L130 690L120 921Q143 936 183 924L190 721L200 596L210 721L217 924Q257 936 280 921L270 690L263 521Q200 537 137 521Z" fill="url(#p)"/>
<path d="M143 548L140 671L132 822M257 548L260 671L268 822M200 549V586" fill="none" stroke="${pantsLight}" stroke-width="3" opacity=".8"/>
<path d="M133 690Q156 700 184 686L182 730Q151 738 132 729Z M267 690Q244 700 216 686L218 730Q249 738 268 729Z" fill="${pants}" opacity=".5"/>
<path d="M121 864L119 926Q145 936 184 926L185 872Q154 882 121 864Z M279 864L281 926Q255 936 216 926L215 872Q246 882 279 864Z" fill="${pants}"/>
<path d="M123 917L183 920L184 966L195 981V999H104Q102 979 111 967L119 954Z M277 917L217 920L216 966L205 981V999H296Q298 979 289 967L281 954Z" fill="#253332"/>
<path d="M129 929L173 932L174 963L120 967Z M271 929L227 932L226 963L280 967Z" fill="#465854"/>
<path d="M130 938L174 941M127 951L174 954M270 938L226 941M273 951L226 954" stroke="#b7bfb1" stroke-width="4"/>
<path d="M113 973Q144 971 183 980M287 973Q256 971 217 980" fill="none" stroke="#64716a" stroke-width="3"/>
<path d="M104 990H195V1000H104Z M205 990H296V1000H205Z" fill="#182522"/>
</svg>`;}
const ski=`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="2000" viewBox="0 0 80 1000">
<path d="M40 0C21 0 10 19 11 47L19 415L18 895L14 970Q13 994 25 1000H55Q67 994 66 970L62 895L61 415L69 47C70 19 59 0 40 0Z" fill="#323c35"/>
<path d="M40 5C24 5 14 22 16 49L24 416L23 896L19 968Q18 987 28 995H52Q62 987 61 968L57 896L56 416L64 49C66 22 56 5 40 5Z" fill="#b0b099"/>
<path d="M40 10C28 10 21 25 22 49L29 355L51 355L58 49C59 25 52 10 40 10Z" fill="#e3e1cf"/>
<path d="M27 148L53 123L49 329L31 345Z" fill="#6f8989"/>
<path d="M24 392H56L56 739H24Z" fill="#354944"/>
<path d="M34 45H37V339H34Z M43 758H47L51 970H47Z" fill="#45564d"/>
<path d="M26 431Q40 422 54 431V472H26Z M27 587H53V658Q40 666 27 658Z" fill="#172a27"/>
<path d="M30 440H50V459H30Z M31 603H49V644H31Z" fill="#7c8a80"/>
<path d="M32 484H48V574H32Z" fill="#89998b"/>
<path d="M25 789L55 813L58 946L50 977H30L22 946Z" fill="#718987"/>
<path d="M27 927L53 952L51 975H30Z" fill="#d0cdb8"/>
</svg>`;
await mkdir(root,{recursive:true});
const files=[];
for(const [file,layer,appearance,refs,svg] of [
 ['appearance-1.webp','AVATAR','APPEARANCE_1',['1.png'],body('#e86433','#f58b52','#b8462d','#23312e','#40514a')],
 ['appearance-2.webp','AVATAR','APPEARANCE_2',['2.png'],body('#d9d6c9','#f0eddf','#a5a79b','#263f41','#466361')],
 ['generic-ski.webp','SKI',null,['3.png','4.png'],ski],
] as const){
 const bytes=await sharp(Buffer.from(svg)).webp({lossless:true,effort:6}).toBuffer();
 if(!await validAvatarRaster(bytes,layer))throw new Error('GENERATED_RASTER_INVALID');
 await writeFile(root+'/'+file,bytes,{flag:'wx'});
 const info=await sharp(bytes).metadata();
 files.push({file,layer,appearance,match:'GENERIC_REFERENCE',sourceFilesUsed:refs,sourcePackage:'サロモン商品.zip',intendedPurpose:'AVATAR_VISUALIZATION_V1',approvedByOwner:true,approvalBasis:'OWNER_AUTHORITY_THIS_DOCUMENT',approvalAuthoritySha256:authoritySha256,localActivationApproved:true,productionApproved:false,rightsBasis:'OWNER_SUPPLIED_SOURCE_DERIVATIVE_LOCAL_USE_ONLY',width:info.width,height:info.height,sha256:digest(bytes),bytes:bytes.length,anchor:{x:0.5,y:1},position:{x:0.5,y:1},exactProductPromise:false});
}
const manifest={version:1,kind:'OWNER_APPROVED_LOCAL_DERIVATIVE_PACKAGE',createdAt:new Date().toISOString(),authoritySha256,sourcePackage:{file:'サロモン商品.zip',sha256:'47930c21f14c1e7580e9b4db9de6f5386b6b19b5b28fc702a37e3474734be27f',files:sources.map(([file,sha256])=>({file,sha256}))},derivation:'Locally authored original vector-to-raster illustration using source clothing palettes and outdoor styling, and generic ski palette. Identical neutral body geometry; no exact product marks, external assets, image model or source photo reconstruction.',rightsScope:'Owner delegated derivative creation and approval for local development/acceptance only; no independent claim to source copyright or Production licensing.',optionalLayers:{BOOT:null,JACKET:null,PANTS:null},deferredSources:['5.png','6.png'],files};
await writeFile(root+'/manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log('PASS local source-derived illustration: 3 static alphaWebP assets, authority-bound LOCAL approval; external assets0.');
