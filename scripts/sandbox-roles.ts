import type {Pool} from 'pg';
/** Existing dedicated flow connection only, no global/production role. */
export async function provisionSandboxJournal(owner:Pool,namespace:string){
 if(!/^zr_[a-f0-9]{12}$/.test(namespace))throw new Error('INVALID_OWNED_DATABASE');
 const role=namespace+'_flow';
 await owner.query(`GRANT SELECT ON sandbox_activation_runs TO ${role}`);
 await owner.query(`GRANT UPDATE(stopped_reason) ON sandbox_activation_runs TO ${role}`);
 await owner.query(`GRANT SELECT,INSERT ON sandbox_activation_calls TO ${role}`);
 await owner.query(`GRANT UPDATE(status,result) ON sandbox_activation_calls TO ${role}`);
}
