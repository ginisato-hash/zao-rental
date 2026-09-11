import Link from 'next/link';
import {getPrincipal} from '../../../lib/auth';
import {ledgerAccess,LedgerError} from '../../../../../../packages/contracts/src/ledger';
import {LedgerWorkspace} from '../../../components/ledger/LedgerWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){
 const principal=await getPrincipal();
 try{ledgerAccess(principal);}catch(error){if(!(error instanceof LedgerError))throw error;return <main><h1>認証が必要です</h1><p>台帳はスタッフ認証と担当店舗の設定が完了するまで利用できません。</p><Link href="/">戻る</Link></main>;}
 return <LedgerWorkspace canEdit={principal?.role==='ADMIN'}/>;
}
