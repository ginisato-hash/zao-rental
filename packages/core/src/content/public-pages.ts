import {publicationApproved,PUBLICATION_ORIGIN} from '../../../auth/src/publication-authority';
import pages from '../../../../config/content/public-p0-pages.json';
import policies from '../../../../config/content/public-policies.draft.json';
export type Locale='ja'|'en';
export const publicPages=pages;
export const publicPolicies=policies;
export const locales:Locale[]=['ja','en'];
export function publicPage(locale:string,path:string){return pages.find(p=>p.locale===locale&&p.path===path)??null;}
export function canonicalPath(locale:Locale,path:string){return '/'+locale+(path?'/'+path:'');}
export function publicOrigin(raw:string|undefined){if(publicationApproved())return PUBLICATION_ORIGIN;if(!raw)return 'http://127.0.0.1';const u=new URL(raw);if(u.origin!==raw||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('INVALID_PUBLIC_ORIGIN');return u.origin;}
export function indexingEnabled(){return publicationApproved();}
/** robots.txt rules for the same authority the proxy and page metadata use. */
export function robotsRules(indexing:boolean){return indexing?{allow:['/ja','/en'],disallow:['/api/','/staff/','/admin/','/preview/','/ja/book','/en/book','/ja/booking/','/en/booking/','/*?*']}:{disallow:'/'};}
export function languages(origin:string,path:string){return {ja:origin+canonicalPath('ja',path),en:origin+canonicalPath('en',path),'x-default':origin+canonicalPath('ja',path)};}
export function safeJsonLd(value:unknown){return JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');}
export type LocationContent={store:'MOUNTAIN_BASE'|'ONSEN_BASE';name:string;address:string|null;telephone:string|null;verified:boolean;openingHours:string};
export function locationSchema(value:LocationContent,url:string){return value.verified&&value.address&&value.telephone?{'@type':'LocalBusiness',name:value.name,address:value.address,telephone:value.telephone,openingHours:value.openingHours,url}:null;}
export function pageSchema(locale:Locale,path:string,origin:string){const p=publicPage(locale,path);if(!p)return [];const base=origin+canonicalPath(locale,'');return [{'@context':'https://schema.org','@type':'Organization',name:'ZAO Rental',url:base},{'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'ZAO Rental',item:base},...(path?[{'@type':'ListItem',position:2,name:p.title,item:origin+canonicalPath(locale,path)}]:[])]}];}
