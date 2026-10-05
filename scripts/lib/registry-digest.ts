import {createHash} from 'node:crypto';

/** Digest of a migration registry (`id:checksum` per row, in order). The restore drill records it for the restored database; the restore evidence finalizer recomputes it from this
 *  checkout's first 53 migration files. A leaf module: the Owner's restore wrapper imports it through the drill and must not pull in the installers' graph. */
export const registryDigest=(rows:ReadonlyArray<{id:string;checksum:string}>)=>createHash('sha256').update(rows.map(r=>r.id+':'+r.checksum).join('\n')).digest('hex');
