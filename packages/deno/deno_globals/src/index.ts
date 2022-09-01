console.debug("Inject deno_globals");
import * as errors from './errors.js';
import { env } from './env.js';
import { build } from './build.js';

const Deno = {
    errors,
    env,
    build,
    args: ARGV,
};

if (!(globalThis as any).Deno) Object.defineProperty(globalThis, 'Deno', { value: Deno });