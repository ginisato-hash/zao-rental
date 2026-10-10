/// <reference types="next/image-types/global" />
import logoStacked from './logo-stacked-black.webp';
import logoStackedWhite from './logo-stacked-white.webp';
import winterDesktop from './campaign-winter-desktop.webp';
import winterMobile from './campaign-winter-mobile.webp';
import skiDesktop from './campaign-ski-desktop.webp';
import skiMobile from './campaign-ski-mobile.webp';
import wearDesktop from './campaign-wear-desktop.webp';
import wearMobile from './campaign-wear-mobile.webp';
import type {Locale} from '../../../../../packages/core/src/content/public-pages';

/** Received SALOMON logos (Owner: web use and colour changes permitted). Sources, trims and hashes: docs/execution/p85-ui/ASSETS.md. */
export const logos={stacked:logoStacked,stackedWhite:logoStackedWhite};
export const BRAND_NAME='SALOMON rental station ZAO';

import {STORE_LABEL} from '../guest-format';
/** Store display names come from the shared display dictionary. */
export const STORE_DISPLAY={MOUNTAIN_BASE:STORE_LABEL.MOUNTAIN_BASE!,ONSEN_BASE:STORE_LABEL.ONSEN_BASE!};

export type Campaign={key:string;title:string;href:string;label:string;alt:string;accent:string;accentText:string;titleColor:string;titleColorMobile:string;desktop:string;mobile:string;positionDesktop:string;positionMobile:string};
/** Official Salomon skiing photos (editorial; never captioned as Zao scenery or as confirmed stock models; never used for snowboard).
 * Accent colours are sampled from each photo; title colours are chosen for contrast on the photo region behind the title. */
export function campaigns(locale:Locale):Campaign[]{const ja=locale==='ja',root='/'+locale;return [
 {key:'winter',title:'WINTER 26/27',href:root+'/book',label:ja?'予約する':'BOOK RENTAL',alt:ja?'雪の斜面を滑るスキーヤー（Salomon公式写真）':'Skier carving on snow (official Salomon photo)',accent:'#E0A020',accentText:'#000000',titleColor:'#806020',titleColorMobile:'#806020',desktop:winterDesktop.src,mobile:winterMobile.src,positionDesktop:'72% 50%',positionMobile:'50% 50%'},
 {key:'ski',title:'SKI',href:root+'/rental/ski',label:ja?'スキーを見る':'VIEW SKI',alt:ja?'スキーヤー（Salomon公式写真）':'Skier (official Salomon photo)',accent:'#80C0E0',accentText:'#000000',titleColor:'#80C0E0',titleColorMobile:'#1F4E79',desktop:skiDesktop.src,mobile:skiMobile.src,positionDesktop:'50% 40%',positionMobile:'50% 50%'},
 {key:'wear',title:'WEAR',href:root+'/rental/wear',label:ja?'ウェアを見る':'VIEW WEAR',alt:ja?'窓辺に立つスキーヤーのシルエット（Salomon公式写真）':'Silhouette of a skier by a window (official Salomon photo)',accent:'#C0A080',accentText:'#000000',titleColor:'#604000',titleColorMobile:'#FFFFFF',desktop:wearDesktop.src,mobile:wearMobile.src,positionDesktop:'64% 50%',positionMobile:'50% 50%'},
];}
