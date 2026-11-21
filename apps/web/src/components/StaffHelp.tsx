'use client';
import {useStaffLocale} from './staff-locale';
import {STAFF_QA} from './staff-qa';
import './staff-orders.css';

/** Staff Q&A: the one place for explanations (Owner 2026-11-20). Grouped by screen; each answer opens on demand. */
export function StaffHelp(){
 const {locale}=useStaffLocale(),en=locale==='en',p=(x:readonly [string,string])=>x[en?1:0];
 return <main className="ox staff-qa">
  <div className="ox-head"><h1>{en?'Staff Q&A':'スタッフQA'}</h1></div>
  <nav className="staff-qa-toc" aria-label={en?'Topics':'項目'}><ul>{STAFF_QA.map(s=><li key={s.id}><a href={'#'+s.id}>{p(s.title)}</a></li>)}</ul></nav>
  {STAFF_QA.map(s=><section key={s.id} id={s.id} className="sx-card staff-qa-section" aria-labelledby={'qa-'+s.id}>
   <h2 id={'qa-'+s.id}>{p(s.title)}</h2>
   {s.items.map((i,n)=><details key={n}><summary>{p(i.q)}</summary><p>{p(i.a)}</p></details>)}
  </section>)}
 </main>;
}
