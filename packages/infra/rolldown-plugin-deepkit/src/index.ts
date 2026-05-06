// Deepkit type-compiler reflection for Rolldown / Rollup / Vite.
//
// Direct port of `@gjsify/esbuild-plugin-deepkit`. Same lazy-loading
// contract: the Deepkit type compiler stays uninstalled until the user
// opts in via `reflection: true`, because its transitive dep
// `@marcj/ts-clone-node` does `require('typescript')` without declaring TS
// as a peer — eagerly importing breaks Yarn-PnP consumers that don't list
// TypeScript themselves.
//
// Hook: `transform(code, id)` with per-source filter via `createFilter`.
// `order: 'pre'` so reflection runs before any other JS transform.

import { inspect } from 'node:util';
import type { Plugin } from 'rolldown';

export interface DeepkitPluginOptions {
    reflection?: boolean;
}

interface DeepkitLoader {
    transform: (contents: string, path: string) => string;
}

let cachedLoader: Promise<DeepkitLoader> | null = null;
async function getLoader(): Promise<DeepkitLoader> {
    if (cachedLoader) return cachedLoader;
    cachedLoader = (async () => {
        const DkType = await import('@deepkit/type-compiler');
        return new DkType.DeepkitLoader() as DeepkitLoader;
    })();
    return cachedLoader;
}

const FILTER = /\.(m|c)?tsx?$/;

function printDiagnostics(...args: unknown[]): void {
    console.log('[deepkit] printDiagnostics', inspect(args, false, 10, true));
}

export function deepkitPlugin(options: DeepkitPluginOptions = {}): Plugin {
    const reflection = options.reflection ?? false;

    return {
        name: 'gjsify-deepkit',
        transform: {
            order: 'pre' as const,
            async handler(code, id) {
                if (!reflection) return null;
                if (!FILTER.test(id)) return null;

                try {
                    const loader = await getLoader();
                    const transformed = loader.transform(code, id);
                    if (transformed === code) return null;
                    return { code: transformed, map: null };
                } catch (error) {
                    printDiagnostics({ file: id, error });
                    return null;
                }
            },
        },
    };
}

export default deepkitPlugin;
