import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/buffer';
import '@gjsify/node-globals/register/url';
import '@gjsify/abort-controller/register'; // AbortController/AbortSignal for tls-abort.gjs.spec (GJS has neither)
import 'fetch/register'; // register fetch/Headers/Request/Response globals on GJS (no-op on Node)
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import rootRelativeSuite from './root-relative.spec.js';
import soupSessionSuite from './soup-session.gjs.spec.js';
import partialInputSuite from './partial-input.gjs.spec.js';
import tlsAbortSuite from './tls-abort.gjs.spec.js';

run({ testSuite, rootRelativeSuite, soupSessionSuite, partialInputSuite, tlsAbortSuite });
