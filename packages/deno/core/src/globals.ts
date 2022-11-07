import { __bootstrap } from './999_bootstrap.js';
import { primordials } from './00_primordials.js';
import {
    core,
    errors,
    env,
    build,
} from './index.js';

const {
    setQueueMicrotask,
    ObjectAssign,
} = primordials;

const Deno = {
    errors,
    env,
    build,
    args: ARGV,
    core,
};


ObjectAssign(globalThis, { __bootstrap });
ObjectAssign(globalThis.__bootstrap, { core });
ObjectAssign(globalThis.Deno, { core });

// Direct bindings on `globalThis`
ObjectAssign(globalThis, { queueMicrotask });
setQueueMicrotask(queueMicrotask);
