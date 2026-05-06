// Public re-exports for `@gjsify/rolldown-plugin-gjsify`.

export * from './types/index.js';
export * from './utils/index.js';
export * from './app/index.js';
export * from './library/index.js';

export {
    REWRITE_FILTER,
    getBundleDirFromOutput,
    rewriteContents,
    shouldRewrite,
    nodeModulesPathRewritePlugin,
} from './plugins/rewrite-node-modules-paths.js';
export type {
    NodeModulesPathRewriteOptions,
    RewriteResult,
} from './plugins/rewrite-node-modules-paths.js';

export { processStubPlugin, GJS_PROCESS_STUB, composeBanner } from './plugins/process-stub.js';
export type { ProcessStubPluginOptions } from './plugins/process-stub.js';
export { cssAsStringPlugin } from './plugins/css-as-string.js';
export { shebangPlugin, GJS_SHEBANG } from './plugins/shebang.js';
export type { ShebangPluginOptions } from './plugins/shebang.js';
export { gjsImportsEmptyPlugin } from './plugins/gjs-imports-empty.js';

export * from './plugin.js';
import { gjsifyPlugin } from './plugin.js';
export { gjsifyPlugin };
export default gjsifyPlugin;

export * from '@gjsify/resolve-npm';
