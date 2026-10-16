import type {Direction} from '../../../contracts/src/recommendation';

export type ReferenceProfile={key:string;sport:string;heightCm:number|null;items:string[]|null};
export type ReferenceOffer={key:string;candidates:Record<string,{lengthCm:number}|null>};
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
/** Presentation of an already saved offer. Never chooses a size or calls a service. */
export function referenceStudy(profile:ReferenceProfile|undefined,offer:ReferenceOffer,direction:Direction){
 if(!profile||profile.key!==offer.key||!['SHORTER','RECOMMENDED','LONGER'].includes(direction))return null;
 if(profile.sport==='WEAR'&&!offer.candidates[direction])return null;
 if(profile.sport==='WEAR')return {sport:'WEAR' as const,heightCm:null,lengthCm:null,ratio:null,ceiling:1};
 if(!['SKI','SNOWBOARD'].includes(profile.sport)||!positive(profile.heightCm)
  ||!(profile.items===null||Array.isArray(profile.items)&&profile.items.includes(profile.sport)))return null;
 const selected=offer.candidates[direction];
 if(!selected||!positive(selected.lengthCm))return null;
 const lengths=['SHORTER','RECOMMENDED','LONGER'].flatMap(d=>positive(offer.candidates[d]?.lengthCm)?[offer.candidates[d]!.lengthCm]:[]);
 // The same scale across directions, including a board longer than the person.
 return {sport:profile.sport as 'SKI'|'SNOWBOARD',heightCm:profile.heightCm,lengthCm:selected.lengthCm,
  ratio:selected.lengthCm/profile.heightCm,ceiling:Math.max(1,...lengths.map(n=>n/profile.heightCm!))};
}
