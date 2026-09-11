import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {SAMPLE} from './ledger-sample';
// Test-only seed. No product route imports this file or exposes an import/auth bypass.
export async function seedLedgerSample(pool:Pool) {
  const checksum=createHash('sha256').update(JSON.stringify(SAMPLE)).digest('hex');
  const client=await pool.connect();const document='tests/fixtures/ledger-sample.ts';
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(71820404)');
    const previous=(await client.query('SELECT checksum FROM ledger_import_receipts WHERE source_document=$1',[document])).rows[0];
    if(previous){if(previous.checksum!==checksum)throw new Error('Sample source checksum drift; no replacement allowed');await client.query('COMMIT');return;}
    await client.query("SELECT set_config('zao.actor','sample-fixture',true),set_config('zao.reason','SYNTHETIC_LEDGER_SAMPLE_V1',true)");
    const column=(key:string)=>key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
    for(const resource of ['models','variants','assets','poles','bundles'] as const)for(const entry of SAMPLE[resource]) {
      const data:Record<string,unknown>={...entry.data,id:entry.id};if(resource==='assets')data.initialStoreId=data.storeId;
      const keys=Object.keys(data);await client.query(`INSERT INTO ledger_${resource} (${keys.map(column).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>data[k]));
    }
    await client.query("INSERT INTO ledger_import_receipts VALUES($1,$2,'SYNTHETIC')",[document,checksum]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
