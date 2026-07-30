// Coverage for `showcase`'s PIN_HINT — the recovery instructions the CLI
// prints when a package runner has served a stale cached copy of itself.
//
// This is the one string in the tree whose ONLY job is to be copy-pasted by a
// user who is already stuck, so a line that is subtly incomplete fails exactly
// when nothing else can help: the running binary is old by definition, and the
// hint is the single thing standing between the user and the fixed release.
//
// The deno line is the reason this file exists. Deno stacks TWO independent
// refusals — the `DENO_DIR` cache (`--reload`) and `minimumDependencyAge`,
// which by default declines any version published in the last 24 h
// (`--min-dep-age=0`). A hint carrying only the first resolves `@latest` to
// the newest release OLDER THAN A DAY, i.e. it hands back the same pre-fix
// binary the user is trying to escape, and does it silently. Measured twice in
// one day: 0.25.1 published minutes earlier, `@latest` resolved to 0.24.1.
//
// Asserting on the flags rather than the whole string keeps this from being a
// change-detector: reword the prose freely, but a runner's line must stay a
// COMPLETE invocation.

import { describe, it, expect } from '@gjsify/unit';
import { PIN_HINT } from './commands/showcase.js';

/** The hint's line for one runner, without the leading indent. */
function lineFor(runner: string): string {
    const line = PIN_HINT.split('\n').find((l) => l.trim().startsWith(runner));
    if (!line) throw new Error(`PIN_HINT has no line for ${runner}`);
    return line.trim();
}

export default async () => {
    await describe('showcase PIN_HINT', async () => {
        await it('offers a line per caching runner', async () => {
            for (const runner of ['npx', 'bunx', 'deno']) {
                expect(lineFor(runner).length).toBeGreaterThan(runner.length);
            }
        });

        await it('pins the tag rather than a baked version', async () => {
            // `@latest` cannot go stale the way a hard-coded version can — but
            // it only MEANS latest once the age waiver below is in place.
            for (const runner of ['npx', 'bunx', 'deno']) {
                expect(lineFor(runner)).toContain('@gjsify/cli@latest');
            }
        });

        await it('busts the deno cache AND waives its 24h age policy', async () => {
            const deno = lineFor('deno');
            expect(deno).toContain('--reload');
            // Without this, `@latest` silently skips a same-day release —
            // precisely the release a stuck user has been told to fetch.
            expect(deno).toMatch(/--min-dep-age[= ]0/);
        });

        await it('runs the package rather than installing it', async () => {
            // `deno run npm:<pkg>` — an `install` line would leave the user
            // with a second copy to keep current, which is this whole class.
            expect(lineFor('deno')).toContain('npm:@gjsify/cli@latest');
        });
    });
};
