# Administrative migration compatibility

Hosted diagnosis: setup is neondb_owner, owns the retained DB, public CREATE=true;
one CREATE TABLE probe succeeds and rolls back. One rollback-only migration diagnostic
completes0001–0014 and fails0015 with42501/ALTER. All changes roll back. The Direct host
maps to the same historical pooled endpoint. No public CREATE repair is indicated.

PostgreSQL18.6 has createrole_self_grant empty. A matching local non-superuser owner
reproduces0015 at ALTER SCHEMA: SET_ROLE_REQUIRED. The migration was originally tested
with a local superuser. Its newly created NOLOGIN custody executor needs CREATE on
the database to receive a schema and CREATE on public to receive functions; the setup
role needs SET and, for0016 CREATE OR REPLACE, INHERIT during this administration.
These are PostgreSQL ownership-transfer requirements, not a need for SUPERUSER.
See [ALTER SCHEMA](https://www.postgresql.org/docs/18/sql-alterschema.html),
[ALTER FUNCTION](https://www.postgresql.org/docs/18/sql-alterfunction.html) and
[createrole_self_grant](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT).

Completion authority sections8/10 permit a minimum administrative compatibility fix.
The canonical migrateHostedDevelopment runner wraps only the verified migration bytes:
0015 is executed in two unchanged contiguous slices at its existing role-creation
boundary, with temporary destination CREATE grants between them. The session-local
self-grant setting is restored immediately after creating the two owned NOLOGIN roles.
After0017, destination CREATE and the creator's explicit SET/INHERIT grants are revoked,
before the migration transaction can COMMIT. Final object owners are exactly those
specified by the immutable migration. No ownership takeover, provider/system-role
change, PUBLIC expansion, permanent executor CREATE, role attribute change or new
runtime grant is introduced. PostgreSQL's automatic creator ADMIN-only membership
remains, with effective SET=false and INHERIT=false. Six payment roles are unaffected.

Local regression applies all30 sources and checks every recorded checksum, unchanged
custody ownership, removed CREATE/SET/INHERIT and PUBLIC CREATE0. The local cluster is
closed. Hosted canonical execution remains a separate single guarded invocation.
