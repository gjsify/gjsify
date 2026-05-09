// Integration-test entry for @gjsify/integration-rollup-pluginutils.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Validates that @rollup/pluginutils — the helper toolkit consumed by
// @gjsify/rolldown-plugin-gjsify — runs end-to-end on GJS. Pillars exercised:
// path (createFilter resolves include/exclude against process.cwd()),
// picomatch glob (transitive dep used by createFilter), and pure-JS string +
// AST helpers (dataToEsm, makeLegalIdentifier, attachScopes,
// extractAssignedNames).

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import createFilterSuite from './create-filter.spec.js';
import dataToEsmSuite from './data-to-esm.spec.js';
import makeLegalIdentifierSuite from './make-legal-identifier.spec.js';
import attachScopesSuite from './attach-scopes.spec.js';
import extractAssignedNamesSuite from './extract-assigned-names.spec.js';

run({
  createFilterSuite,
  dataToEsmSuite,
  makeLegalIdentifierSuite,
  attachScopesSuite,
  extractAssignedNamesSuite,
});
