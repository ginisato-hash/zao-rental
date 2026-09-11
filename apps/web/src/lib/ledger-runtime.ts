import 'server-only';
import {getPrincipal} from './auth';
import {ledgerHandler} from './ledger-http';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
// E05 must wire a verified store-scoped session and a separately provisioned DB connection.
// No ambient DATABASE_URL, sample data, test identity or admin flag is accepted here.
export const handleLedger=ledgerHandler(getPrincipal,()=>{throw new LedgerError('STORAGE_NOT_CONNECTED',503);});
