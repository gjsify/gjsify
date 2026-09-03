import { run } from '@gjsify/unit';

import testSuiteGamepad from './gamepad.spec.js';
// Loads `@gjsify/gamepad/register` by package specifier per the /register
// convention. It must NOT make the bundle require `gi://Manette` at LOAD — the
// suite has to be runnable on a host with no Manette typelib, which is the very
// situation this package is about. See the header of `register.spec.ts` for how
// that is kept true, and `status/open-todos.md` for the measurement.
import testSuiteRegister from './register.spec.js';
// LAST on purpose: the backend suite injects fake `gi://Manette` modules into the
// shared probe cache. It hands the cache back at the end, but ordering it after
// the suites that read the real host keeps that independent of its own cleanup.
import testSuiteBackend from './backend.spec.js';

run({ testSuiteGamepad, testSuiteRegister, testSuiteBackend });
