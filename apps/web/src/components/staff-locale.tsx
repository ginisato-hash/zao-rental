'use client';
import {createContext,useContext,useState} from 'react';
import type {StaffLocale} from './staff-i18n';

/** One staff/admin language for every screen (Issue #47 consolidated order §2). The shell provides the saved locale
 * (cookie, also used for SSR and html lang) and the switch; components read it here instead of keeping their own
 * toggle. Switching re-renders text in place: no remount, so store/date/filters/forms/pending requests are kept. */
type Ctx={locale:StaffLocale;setLocale:(next:StaffLocale)=>void};
export const StaffLocaleContext=createContext<Ctx|null>(null);
export function useStaffLocale():Ctx{
 const shared=useContext(StaffLocaleContext);
 // Outside the shell (e.g. an isolated test page) keep a local fallback so the component still works.
 const [local,setLocal]=useState<StaffLocale>('ja');
 return shared??{locale:local,setLocale:setLocal};
}
