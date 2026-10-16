'use client';
import {useId,useState} from 'react';
import type {Direction} from '../../../../packages/contracts/src/recommendation';
import type {Locale} from '../../../../packages/core/src/content/public-pages';
import {referenceStudy,type ReferenceProfile,type ReferenceOffer} from '../../../../packages/core/src/avatar/reference';
import graphite from './brand/reference/person-graphite.webp';
import chalk from './brand/reference/person-chalk.webp';
import ski from './brand/reference/ski.webp';
import snowboard from './brand/reference/snowboard.webp';
import {WEAR_COLOR_NOTICE} from './wear-copy';
import './reference-study.css';

/** Bundled original generic artwork; saved measurements never enter image URLs.
 * No fetch, storage, business callbacks, or dependency on the private artwork grant. */
export function GuestAvatarPreview({profile,offer,direction,locale}:{profile:ReferenceProfile|undefined;offer:ReferenceOffer;direction:Direction;locale:Locale}){
 const [appearance,setAppearance]=useState(0),[failed,setFailed]=useState(false),id=useId();
 const study=referenceStudy(profile,offer,direction);if(!study)return null;
 const ja=locale==='ja',wear=study.sport==='WEAR',person=appearance===0?graphite:chalk,gear=study.sport==='SKI'?ski:snowboard;
 const floor=40+1000*study.ceiling,height=floor+40,bodyY=floor-1000,gearHeight=1000*(study.ratio??0);
 const bodyWidth=person.width/person.height*1000,gearWidth=gear.width/gear.height*gearHeight;
 const label={RECOMMENDED:ja?'おすすめ':'Recommended',SHORTER:ja?'短め':'Shorter',LONGER:ja?'長め':'Longer'}[direction];
 return <section className="guest-avatar fit-study" aria-labelledby={id} data-sport={study.sport}>
  <header className="fit-study-head"><div><p className="fit-kicker">{wear?'WEAR / REFERENCE':study.sport+' / SIZE STUDY'}</p><h3 id={id}>{ja?(wear?'ウェアのイメージ':'長さを、見比べる。'):(wear?'The wear reference.':'See the length.')}</h3></div><span className="fit-study-mark" aria-hidden="true">↕</span></header>
  <div className="fit-study-content">
    {!wear&&<dl className="fit-study-measures" aria-live="polite"><div><dt>{ja?'身長':'Your height'}</dt><dd>{study.heightCm}<span>cm</span></dd></div><div><dt>{label}</dt><dd>{study.lengthCm}<span>cm</span></dd></div></dl>}
   <div className="fit-study-figure">
    {!failed?<svg viewBox={'0 0 840 '+height} className="fit-study-stage" data-avatar-stage aria-hidden="true" focusable="false">
     {[0,.25,.5,.75,1].map(f=><line key={f} x1="58" x2="782" y1={floor-f*1000} y2={floor-f*1000} className={f===0?'fit-floor':'fit-grid'}/>)}
     {!wear&&<path d={'M84 '+bodyY+'H110 M96 '+bodyY+'V'+floor+' M84 '+floor+'H110'} className="fit-ruler"/>}
     <image data-layer="AVATAR" href={person.src} x={wear?420-bodyWidth/2:156} y={bodyY} width={bodyWidth} height="1000" onError={()=>setFailed(true)}/>
     {!wear&&<><image data-layer={study.sport} href={gear.src} x={627-gearWidth/2} y={floor-gearHeight} width={gearWidth} height={gearHeight} onError={()=>setFailed(true)}/><path d={'M748 '+(floor-gearHeight)+'H772 M760 '+(floor-gearHeight)+'V'+floor+' M748 '+floor+'H772'} className="fit-ruler fit-ruler--gear"/></>}
    </svg>:<p className="fit-image-unavailable" role="status">{ja?'参考画像を表示できません。寸法は候補欄で確認できます。':'The reference image is unavailable. Measurements remain in the size options.'}</p>}
    <p className="fit-figure-caption">{ja?'汎用の参考イラスト':'Generic reference illustration'}</p>
   </div>
   <div className="fit-study-info">

    <fieldset className="fit-appearance"><legend>{ja?'表示カラー（参考）':'Illustration colour'}</legend><div>{[graphite,chalk].map((_,i)=><button type="button" key={i} aria-pressed={appearance===i} aria-label={(ja?'見た目 ':'Appearance ')+(i+1)+' · '+(i===0?'GRAPHITE':'CHALK')} onClick={()=>setAppearance(i)}><span className={'fit-swatch fit-swatch--'+i} aria-hidden="true"/><span>{i===0?'GRAPHITE':'CHALK'}</span><span aria-hidden="true">{appearance===i?'●':'○'}</span></button>)}</div></fieldset>
    <p className="fit-study-note">{ja?(wear?'色と形の参考です。実際のウェアや着用時のフィットを示すものではありません。':'身長と板の長さを同じ縮尺で表示。体型・板の幅・実際の商品やフィットを示すものではありません。'):(wear?'A reference for colour and shape, not the actual garments or their fit.':'Your height and '+(study.sport==='SKI'?'ski':'snowboard')+' length use the same scale. Body shape, equipment width, actual products and fit are not represented.')}</p>
    <p className="fit-study-footnote">{wear?WEAR_COLOR_NOTICE[locale]:(ja?'表示のみの切替です。サイズ・料金は変わりません。':'Illustration only. Sizing and pricing stay the same.')}</p>
   </div>
  </div>
 </section>;
}
