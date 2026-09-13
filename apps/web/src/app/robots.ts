import type {MetadataRoute} from 'next';
import {indexingEnabled,publicOrigin} from '../../../../packages/core/src/content/public-pages';
export default function robots():MetadataRoute.Robots{const origin=publicOrigin(process.env.ZAO_PUBLIC_ORIGIN);return {rules:{userAgent:'*',...(indexingEnabled()?{allow:['/ja','/en'],disallow:['/api/','/staff/','/admin/','/preview/','/ja/book','/en/book','/ja/booking/','/en/booking/','/*?*']}:{disallow:'/'} )},sitemap:origin+'/sitemap.xml'};}
