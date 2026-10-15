/// <reference types="next/image-types/global" />
import smax8_800 from './product-smax8-800.webp';
import smax8_1280 from './product-smax8-1280.webp';
import qst800 from './product-qst-800.webp';
import qst1280 from './product-qst-1280.webp';
import assassin800 from './product-assassin-800.webp';
import assassin1280 from './product-assassin-1280.webp';
import reflect800 from './product-reflect-800.webp';
import reflect1280 from './product-reflect-1280.webp';
import ride800 from './product-huckknife-ride-800.webp';
import ride1280 from './product-huckknife-ride-1280.webp';
import logoStacked from './logo-stacked-black.webp';
import winterDesktop from './campaign-winter-desktop.webp';
import winterMobile from './campaign-winter-mobile.webp';
import wearDesktop from './campaign-wear-desktop.webp';
import wearMobile from './campaign-wear-mobile.webp';
import skiDesktop from './campaign-ski-desktop.webp';
import skiMobile from './campaign-ski-mobile.webp';
import type {Locale} from '../../../../../packages/core/src/content/public-pages';

/** Official Salomon imagery only (R64). Product images are the SALOMON STATION ZAO LP derivatives (Owner-approved official
 * tie-up; provenance: LP v2 site/src/salomon-assets.json, recorded in docs/execution/r64-ui/ASSETS.md). Campaign photographs
 * are the P85 derivatives (docs/execution/p85-ui/ASSETS.md). Never captioned as Zao scenery or as confirmed stock models;
 * ski photographs are never used for snowboard. */
export type Shot={key:string;src:string;srcSet:string;width:number;height:number;alt:{ja:string;en:string}};
const set=(...v:{src:string;width:number}[])=>v.map(x=>x.src+' '+x.width+'w').join(', ');
export const products={
 regular:{key:'smax8',src:smax8_1280.src,srcSet:set(smax8_800,smax8_1280),width:1600,height:2000,alt:{ja:'SALOMON S/MAX 8 スキー（Salomon公式製品画像）',en:'SALOMON S/MAX 8 skis (official Salomon product image)'}},
 premium:{key:'qst',src:qst1280.src,srcSet:set(qst800,qst1280),width:1600,height:2000,alt:{ja:'SALOMON S/LAB QST BLANK で滑るスキーヤー（Salomon公式写真）',en:'Skier on SALOMON S/LAB QST BLANK skis (official Salomon photo)'}},
 /** R67 (Owner): REFLECT, a lower-priced official board, is the Regular snowboard image; ASSASSIN (top grade) is Premium. */
 snowboard:{key:'reflect',src:reflect1280.src,srcSet:set(reflect800,reflect1280),width:1600,height:2000,alt:{ja:'SALOMON REFLECT スノーボード（Salomon公式製品画像）',en:'SALOMON REFLECT snowboard (official Salomon product image)'}},
 snowboardPremium:{key:'assassin',src:assassin1280.src,srcSet:set(assassin800,assassin1280),width:1600,height:2000,alt:{ja:'SALOMON ASSASSIN PRO スノーボード（Salomon公式製品画像）',en:'SALOMON ASSASSIN PRO snowboard (official Salomon product image)'}},
 /** Premium snowboard riding photograph (official; HUCK KNIFE PRO, a graphic high-grade pro model) — pairs with the Premium ski riding photograph. */
 snowboardRide:{key:'huckknife-ride',src:ride1280.src,srcSet:set(ride800,ride1280),width:1600,height:2000,alt:{ja:'SALOMON HUCK KNIFE PRO でカービングするスノーボーダー（Salomon公式写真）',en:'Snowboarder carving on a SALOMON HUCK KNIFE PRO (official Salomon photo)'}},
} satisfies Record<string,Shot>;
export const photos={
 winter:{desktop:winterDesktop.src,mobile:winterMobile.src,alt:{ja:'雪の斜面を滑るスキーヤー（Salomon公式写真）',en:'Skiers carving on snow (official Salomon photo)'}},
 wear:{desktop:wearDesktop.src,mobile:wearMobile.src,alt:{ja:'窓辺に立つスキーヤーのシルエット（Salomon公式写真）',en:'Silhouette of a skier by a window (official Salomon photo)'}},
 ski:{desktop:skiDesktop.src,mobile:skiMobile.src,alt:{ja:'スキーヤー（Salomon公式写真）',en:'Skier (official Salomon photo)'}},
};
/** Desktop-only menu hover crops (LP .mimg), decorative. */
export const menuImages:Record<string,string>={rental:smax8_800.src,prices:qst800.src,stores:wearMobile.src,faq:winterMobile.src};
export const alt=(s:{alt:{ja:string;en:string}},l:Locale)=>s.alt[l];

/** Official SALOMON STATION ZAO logo (LP asset, sha256 d5b7dad0…dd4ac). Always an image, never re-set in type. */
export const logo={src:logoStacked.src,width:480,height:103};
