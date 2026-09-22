// PROD-R4 (integration-corrected): the backup identity is an operational credential/role created
// after R3 schema bootstrap, not application schema — so this is a pure SQL-plan generator, never
// a migration file. No DB access, no password, no CREATE happens here; an operator applies this
// plan once against the real Production database, then separately flips the role to LOGIN with
// a real password, out of band, never in git.
const IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;
const ZR_PATTERN = /^zr_[a-f0-9]{12}$/;
// F10 (TD correction): explicit 63-byte Postgres identifier contract, checked directly rather
// than relying only on the regex's own length bound, so the intent is unambiguous and testable
// the same way across all three role-plan generators in this integration.
const MAX_IDENTIFIER_BYTES = 63;

export function assertProductionDatabaseName(databaseName: string): void {
  if (!IDENTIFIER.test(databaseName) || ZR_PATTERN.test(databaseName)) throw new Error('PRODUCTION_DATABASE_NAME_INVALID');
}
export function assertProductionRoleName(roleName: string): void {
  if (!IDENTIFIER.test(roleName) || Buffer.byteLength(roleName, 'utf8') > MAX_IDENTIFIER_BYTES) throw new Error('PRODUCTION_ROLE_NAME_INVALID');
}

/** Least-privilege read-only role for a Production logical backup (pg_dump -Fc --no-owner
 * --no-acl). NOLOGIN, no password, no ownership, no write/DDL/replication grant — `pg_read_all_data`
 * is the correct minimum practical pg_dump grant (grants SELECT on every current AND FUTURE
 * table/view/sequence in one membership, so a new migration's tables need no follow-up grant;
 * an enumerated per-table list, as this project uses for narrow business roles, would be the
 * wrong tool for "must be able to read literally everything for a faithful backup"). INHERIT
 * (not the NOINHERIT this project's app-privilege-separation roles use) because this role is
 * meant to be the direct LOGIN identity for the whole pg_dump session, not assumed via SET ROLE
 * from another identity — its pg_read_all_data membership must be active on connection alone. */
export function productionBackupRoleSql(databaseName: string, roleName: string = databaseName + '_backup'): string[] {
  assertProductionDatabaseName(databaseName);
  assertProductionRoleName(roleName);
  return [
    `CREATE ROLE ${roleName} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`,
    `GRANT CONNECT ON DATABASE ${databaseName} TO ${roleName}`,
    `GRANT pg_read_all_data TO ${roleName}`,
  ];
}
