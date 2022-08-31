import * as errors from './errors.js';
import { env } from './env.js';
import { build } from './build.js';

const Deno = {
    errors,
    env,
    build,
};

if (!(globalThis as any).Deno) Object.defineProperty(globalThis, 'Deno', { value: Deno });