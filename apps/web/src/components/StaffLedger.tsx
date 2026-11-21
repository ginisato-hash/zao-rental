 'use client';
import {useMemo} from 'react';
import {LedgerWorkspace} from './ledger/LedgerWorkspace';
import {createHttpLedgerClient} from './ledger/client';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
/** Inventory → ledger (models, sizes, items, history). Navigation and sign-out belong to the shell. */
export function StaffLedger({stamp,canEdit,canEditGlobal}:{stamp:string;canEdit:boolean;canEditGlobal:boolean;canManageStaff?:boolean}){
 const client=useMemo(()=>createHttpLedgerClient(stamp,invalidateStaffView),[stamp]);
 return <StaffSessionBoundary stamp={stamp}><LedgerWorkspace client={client} canEdit={canEdit} canEditGlobal={canEditGlobal}/></StaffSessionBoundary>;
}
