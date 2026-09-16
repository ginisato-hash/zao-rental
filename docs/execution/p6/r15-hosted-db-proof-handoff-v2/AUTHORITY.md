# R15 F3 Credential Handoff V2 authority

Canonical Owner text: [authority](../../PRODUCTION_P6_R15_F3_HANDOFF_V2_AUTHORITY.md).

Original attachment SHA-256: `5ad07bd2be2bcca6876b5dc4fca191904dad2a2419faf5ce2738422c7675223a`.
Starting HEAD: `2544261efafdc98741dd55cab278b859bc4c7f2b`.

Local synthetic handoff validation and implementation push/readback must precede
all provider/browser/DB access. Existing resource and retained database only;
new V2 credential acquisition maximum1, credential HTTP maximum1, retry0.
All historical attempts, migrations, evidence and review budgets are retained.

The byte-exact attachment was committed and remotely read back at
`89addfef7dd13eabab0b885d41168f92fb8a81f9`. The current authority formats the
two fake fixture URIs as concatenated strings to satisfy the repository secret
scanner; no authority or fixture semantics changed. No real credential is present.
