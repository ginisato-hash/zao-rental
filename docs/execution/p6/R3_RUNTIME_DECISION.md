# P6 R3 runtime / deployment decision (parent-owned)

## Separate causes

A: first-project creation was production despite explicit preview. CLI59.9.1's
bundled client strips preview target before POST. Attempt1 is preserved, failed,
removed, never Preview acceptance. Use one static Build Output API placeholder,
`--prod --skip-domain`, protection enabled and production application secrets absent.
No application code/installer/DB/provider is included. No domains/aliases are allowed;
keep bootstrap until a verified Preview exists. No promote or Git integration.

B: actual preserved cloud log reported Node24.19.0/npm11.17.0; required
Node24.15.x/npm11.12.x and engine-strict rejected npm install (EBADENGINE). The failed
deployment was removed; immutable sanitized log+manifest are the source, not a
fabricated new retrieval or a guessed version.

## Toolchain decision

- `engines.node=24.x` matches Vercel's major-only guarantee. `.nvmrc`, setup guard
  and GitHub CI remain Node24.15.0; cloud patch is recorded on each acceptance.
- npm `packageManager=npm@11.12.1`, engines11.12.x, engine-strict=true remain.
  Use Vercel's documented custom Install Command with exact npm via npx for `npm ci`;
  exact npm also launches build, and both Node/npm versions are printed (only versions).
  Corepack is officially supported but experimental and requires an extra environment
  switch. The documented explicit install-command method achieves the same exact pin
  without adding an environment setting or silently accepting the host npm version.
- `vercel.json` holds per-deployment settings, leaving the Project's persisted framework,
  root and environment settings unchanged. Root stays `./`; Next build already outputs
  `apps/web/.next`, so explicitly set that Output Directory. Installed @vercel/next
  reads manifests from entryPath+config.outputDirectory. No framework/business change.
- Lockfile change is ONLY root package engines.node metadata, not regeneration.
  No dependency version/resolution/integrity changes. npm ci must leave lockfile stable.
- Local verification: npm ci, lint, typecheck, build, pure readiness/toolchain tests.
  Full verify would start real DB/controller suites unrelated to this scoped fix;
  it is not selected for this no-external-DB acceptance boundary. Existing regressions
  and CI results are retained, never represented as new cloud runtime evidence.

## Sources checked for R3

- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- https://vercel.com/docs/cli/deploying-from-cli
- https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting
- https://vercel.com/docs/builds/configure-a-build
- https://vercel.com/kb/guide/how-do-i-use-the-latest-npm-version-for-my-vercel-deployment
- https://vercel.com/docs/build-output-api/configuration

Generated unique deployment URL is a platform address, not permission to alias a
production/custom domain or permit unauthenticated traffic. Readback must prove this.
