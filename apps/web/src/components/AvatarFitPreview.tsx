'use client';
import {useState} from 'react';
import Image from 'next/image';
import type {Direction} from '../../../../packages/contracts/src/recommendation';
import type {AvatarVisualizationV1} from '../../../../packages/contracts/src/avatar-visualization';
import type {Locale} from '../../../../packages/core/src/content/public-pages';
import {avatarLayout,type AvatarLayerBox} from '../../../../packages/core/src/avatar/layout';
import './avatar.css';
export const avatarDirectionLabels={ja:{RECOMMENDED:'おすすめ',SHORTER:'短め',LONGER:'長め'},en:{RECOMMENDED:'Recommended',SHORTER:'Shorter',LONGER:'Longer'}};
const disclaimer={ja:'相対的な見た目の参考です。適合・安全・在庫・モデル確約・予約成立・決済完了を保証しません。',en:'A visual reference for relative proportions. It does not guarantee fit, safety, stock, a particular model, a confirmed booking or completed payment.'};
function Layer({box}:{box:AvatarLayerBox}){const [failed,setFailed]=useState(false);return <div className="avatar-layer" data-layer={box.visual.layer} data-match={box.visual.match} style={{left:box.x+'%',top:box.y+'%',width:box.width+'%',height:box.height+'%'}} aria-hidden="true">
 {!failed&&<Image unoptimized src={box.src} alt="" fill sizes="(max-width: 390px) 100vw, 352px" loading="lazy" draggable={false} onError={()=>setFailed(true)}/>}</div>;}
/** Presentation only: these props provide no business callback or authority. Native
 * same-origin image GETs bypass Next's image cache so every new GET reauthorizes. */
export function AvatarFitPreview({visualization,direction,locale}:{visualization?:AvatarVisualizationV1|null;direction:Direction;locale:Locale}){
 const layout=avatarLayout(visualization,direction);if(!layout)return null;const ja=locale==='ja',label=avatarDirectionLabels[locale][direction];
 return <section className="avatar-fit" lang={locale} aria-label={ja?'サイズの見た目を確認':'Visual size reference'}>
  <header className="avatar-heading"><p className="avatar-eyebrow">SIZE REFERENCE</p><h2>{ja?'長さのバランスを見る':'See the proportions'}</h2><p>{ja?'見た目を比べながら、長さを確認できます。':'Compare the proportions alongside the measurements.'}</p></header>
  <div className="avatar-stage-wrap"><div className="avatar-stage" data-avatar-stage style={{aspectRatio:layout.width+'/'+layout.height}}>
   <div className="avatar-floor" aria-hidden="true" style={{top:layout.floor+'%'}}/>
   {layout.boxes.map(box=><Layer key={box.visual.id+box.visual.derivativeSha256} box={box}/>)}</div></div>
  <div className="avatar-measures" aria-live="polite">
   {layout.customerHeightCm!==null&&<p><span>{ja?'身長':'Your height'}</span><strong>{layout.customerHeightCm}<small> cm</small></strong></p>}
   {layout.skiLengthCm!==null?<p><span>{label}</span><strong>{layout.skiLengthCm}<small> cm</small></strong></p>:visualization?.customerHeightCm!==undefined?<p>{ja?'この方向のスキー候補はありません。':'No ski candidate is available in this direction.'}</p>:<p>{ja?'ウェアの重なりを確認':'View the clothing layers'}</p>}
  </div>
  <p className="avatar-reference-label">{ja?'参考イメージ':'Reference illustration'}</p><p className="avatar-disclaimer">{disclaimer[locale]}</p>
 </section>;
}
