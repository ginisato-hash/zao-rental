'use client';
import {useState} from 'react';
import type {Direction} from '../../../../packages/contracts/src/recommendation';
import {AVATAR_TYPES,type AvatarType} from '../../../../packages/contracts/src/avatar-visualization';
import type {AvatarPreviewPayloads} from '../../../../packages/core/src/avatar/preview';
import type {Locale} from '../../../../packages/core/src/content/public-pages';
import {AvatarFitPreview,avatarDirectionLabels} from './AvatarFitPreview';
export function AvatarCustomerPreview({payloads,locale}:{payloads:AvatarPreviewPayloads;locale:Locale}){
 const [appearance,setAppearance]=useState<AvatarType>('APPEARANCE_1'),[direction,setDirection]=useState<Direction>('RECOMMENDED');const ja=locale==='ja',value=payloads[appearance];
 return <main className="avatar-preview" lang={locale}><header className="avatar-preview-header"><p className="avatar-eyebrow">ZAO RENTAL · STAFF PREVIEW</p><h1>{ja?'レンタルの見た目を確認':'Rental visual preview'}</h1><p className="avatar-test-notice">SYNTHETIC · TEST ONLY — {ja?'合成素材によるスタッフ用確認画面です。実商品・顧客向け素材ではありません。':'Synthetic artwork for staff testing. These are not real products or customer assets.'}</p></header>
 <div className="avatar-preview-grid"><aside className="avatar-controls"><fieldset><legend>{ja?'見た目':'Appearance'}</legend><p>{ja?'サイズや料金には影響しません。':'This does not affect sizing or pricing.'}</p><div className="avatar-buttons">{AVATAR_TYPES.map((a,i)=><button type="button" key={a} aria-pressed={appearance===a} onClick={()=>setAppearance(a)}>{ja?'見た目 '+(i+1):'Appearance '+(i+1)}</button>)}</div></fieldset>
 <fieldset><legend>{ja?'比較する長さ':'Length to compare'}</legend><div className="avatar-buttons avatar-directions">{(['SHORTER','RECOMMENDED','LONGER'] as const).map(d=><button type="button" key={d} aria-pressed={direction===d} disabled={!!value?.customerHeightCm&&!value.candidates[d]} onClick={()=>setDirection(d)}>{avatarDirectionLabels[locale][d]}{value?.candidates[d]&&<small>{value.candidates[d]!.skiLengthCm} cm</small>}</button>)}</div></fieldset><p className="avatar-control-note">{ja?'表示の切替のみです。予約条件や在庫は変更されません。':'These controls change the view only. Booking conditions and stock remain unchanged.'}</p></aside>
 <div><AvatarFitPreview visualization={value} direction={direction} locale={locale}/>{!value&&<p role="status">{ja?'表示できる素材がありません。予約の情報は変わりません。':'No artwork is available. Booking information is unchanged.'}</p>}</div></div></main>;
}
