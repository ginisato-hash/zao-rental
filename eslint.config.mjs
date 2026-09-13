import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
  ...nextVitals, ...nextTs,
  { settings: { next: { rootDir: 'apps/web/' } }, rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  // Private navigation intentionally reloads the document to discard session-scoped state.
  // The new locale catch-all makes Next's URL heuristic also match these existing routes.
  {files:['apps/web/src/app/staff/**/*.tsx','apps/web/src/app/preview/**/*.tsx','apps/web/src/components/*Workspace.tsx','apps/web/src/components/Staff*.tsx','tests/content/Workspace.tsx','tests/flow-app/src/app/staff/**/*.tsx'],rules:{'@next/next/no-html-link-for-pages':'off'}},
  globalIgnores(['**/.next/**', '**/node_modules/**', '**/.local/**', '**/next-env.d.ts', 'test-results/**', 'playwright-report/**']),
]);
