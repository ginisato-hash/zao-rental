import 'server-only';
import {publicContentPool} from './public-runtime';
import {releasedModels} from '../../../../packages/core/src/content/public-catalog';
import {publicPolicies,publicPage,type Locale} from '../../../../packages/core/src/content/public-pages';
import type {ContentWorkflowState} from '../../../../packages/core/src/content/workflow';
export async function publicModels(){const p=publicContentPool();return p?releasedModels(p):[];}
export async function modelState(slug:string){const p=publicContentPool();return p?(await p.query('SELECT state FROM content_model_previews WHERE slug=$1',[slug])).rows[0]?.state:null;}
export async function pageContent(locale:Locale,path:string){const fallback=publicPage(locale,path);if(!fallback)return null;const p=publicContentPool();if(!p)return fallback;const state=(await p.query('SELECT value FROM content_workspace WHERE id=true')).rows[0]?.value as ContentWorkflowState|undefined;const rel=state?.catalog.releases.find(r=>r.id===state.catalog.current),revision=state?.catalog.revisions.find(r=>rel?.entries.includes(r.id)&&r.offerCode===(path||'home')&&r.locale===locale);return revision?{...fallback,title:revision.content.title,heading:revision.content.title,summary:revision.content.summary}:fallback;}
export async function latePickupCopy(locale:Locale){const p=publicContentPool();const row=p?(await p.query("SELECT ja,en FROM content_public_policies WHERE id='latePickupPolicy'")).rows[0]:null;return row?.[locale]??publicPolicies.latePickupPolicy[locale];}
