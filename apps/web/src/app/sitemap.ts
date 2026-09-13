import {publicModels} from '../lib/public-content';
import type {MetadataRoute} from 'next';
import {publicPages,canonicalPath,publicOrigin,indexingEnabled,languages,type Locale} from '../../../../packages/core/src/content/public-pages';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{if(!indexingEnabled())return [];const origin=publicOrigin(process.env.ZAO_PUBLIC_ORIGIN);return [...publicPages,...(await publicModels()).flatMap(m=>['ja','en'].map(locale=>({locale,path:'rental/premium/'+m.slug})))].map(p=>({url:origin+canonicalPath(p.locale as Locale,p.path),alternates:{languages:languages(origin,p.path)}}));}
