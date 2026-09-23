export const dynamic='force-dynamic';
import type {MetadataRoute} from 'next';
import {indexingEnabled,publicOrigin,robotsRules} from '../../../../packages/core/src/content/public-pages';
export default function robots():MetadataRoute.Robots{const origin=publicOrigin(process.env.ZAO_PUBLIC_ORIGIN);return {rules:{userAgent:'*',...robotsRules(indexingEnabled())},sitemap:origin+'/sitemap.xml'};}
