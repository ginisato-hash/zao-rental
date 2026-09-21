'use client';
import {useEffect,useState} from 'react';
import {AVATAR_TYPES,type AvatarType} from '../../../../packages/contracts/src/avatar-visualization';
import type {Direction} from '../../../../packages/contracts/src/recommendation';
import {guestAvatarPath,type GuestAvatarScope} from '../../../../packages/contracts/src/guest-avatar';
import type {AvatarPreviewPayloads} from '../../../../packages/core/src/avatar/preview';
import type {Locale} from '../../../../packages/core/src/content/public-pages';
import {AvatarFitPreview} from './AvatarFitPreview';
/** Optional read-only companion. No business callbacks, storage or write requests. */
export function GuestAvatarPreview({scope,direction,locale}:{scope:GuestAvatarScope;direction:Direction;locale:Locale}){
 const path=guestAvatarPath(scope),[loaded,setLoaded]=useState<{path:string;payloads:AvatarPreviewPayloads}|null>(null),[appearance,setAppearance]=useState<AvatarType>('APPEARANCE_1');
 useEffect(()=>{
  if(!path)return;const abort=new AbortController();let active=true;
  void fetch('/api/guest/avatar/'+path,{cache:'no-store',credentials:'same-origin',signal:abort.signal}).then(async r=>{
   if(!r.ok)return;const payloads=await r.json() as AvatarPreviewPayloads;
   if(active&&payloads&&typeof payloads==='object'&&!Array.isArray(payloads))setLoaded({path,payloads});
  }).catch(()=>{/* Optional artwork failure leaves booking behavior unchanged; no retry. */});
  return()=>{active=false;abort.abort();};
 },[path]);
 if(!path||loaded?.path!==path||!AVATAR_TYPES.some(a=>loaded.payloads[a]))return null;
 const ja=locale==='ja';
 return <section className="guest-avatar" aria-label={ja?'参考イメージの見た目':'Reference appearance'}>
  <fieldset><legend>{ja?'見た目':'Appearance'}</legend><p>{ja?'サイズや料金は変わりません。':'This does not change sizing or pricing.'}</p><div className="avatar-buttons">{AVATAR_TYPES.map((a,i)=><button type="button" key={a} aria-pressed={appearance===a} onClick={()=>setAppearance(a)}>{ja?'見た目 '+(i+1):'Appearance '+(i+1)}</button>)}</div></fieldset>
  <AvatarFitPreview visualization={loaded.payloads[appearance]} direction={direction} locale={locale} mediaScope={scope}/>
 </section>;
}
