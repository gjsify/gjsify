// runStorybook — the one-call entry point a host launcher or the
// `gjsify storybook` generated entry uses. original implementation.

// The bare `system` built-in, not `imports.system`/`ARGV` (ARGV IS
// `system.programArgs` on gjs) — resolves on gjs AND the `--app node` reverse
// bridge, i.e. `gjsify storybook --runtime node` (AGENTS.md § The legacy
// imports.* object is NOT an API).
import system from 'system';

import { StorybookApplication, type StorybookOptions } from './application.js';

/**
 * Construct and run a storybook application, resolving with its exit code when
 * the window closes. The whole per-project launcher collapses to:
 *
 * ```ts
 * import { runStorybook, collectStoryModules } from '@gjsify/storybook';
 * import * as bar from './widgets/bar.story.js';
 * await runStorybook({ applicationId: 'org.example.Storybook', stories: collectStoryModules([bar]) });
 * ```
 */
export async function runStorybook(options: StorybookOptions): Promise<number> {
    const app = new StorybookApplication(options);
    return app.runAsync([system.programInvocationName, ...system.programArgs]);
}
