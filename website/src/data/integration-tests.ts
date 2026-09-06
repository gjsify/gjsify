// Selected integration test suites from `tests/integration/*`: each runs a real
// npm package's own test suite (or a curated subset) against `@gjsify/*`, so the
// claim is "this real-world library works on GJS", not "our polyfill tests pass".
// Rendered as a grid rather than a percentage — there is no "all npm packages"
// denominator to divide by.

export interface IntegrationSuite {
    /** npm package being exercised */
    name: string;
    /** What gjsify surface is validated */
    exercises: string;
    category: 'build' | 'network' | 'stream' | 'fs' | 'parse' | 'process' | 'core' | 'p2p' | 'test-harness';
    /** GJS-only when it requires native bridges that don't load on Node */
    gjsOnly?: boolean;
}

export const integrationSuites: readonly IntegrationSuite[] = [
    { name: 'acorn', exercises: 'ESM parser / AST — SpiderMonkey 140 canary', category: 'parse' },
    { name: 'deepkit-type-compiler', exercises: 'TypeScript reflection emitter', category: 'build' },

    { name: 'rolldown-native', exercises: 'Native Vala/Rolldown plugin bridge', category: 'build', gjsOnly: true },
    { name: 'rollup-pluginutils', exercises: 'Path + glob (picomatch)', category: 'build' },
    { name: 'fast-glob', exercises: 'fs URL paths, readdir/stat/lstat, symlinks', category: 'fs' },
    { name: 'lightningcss', exercises: 'Byte-equality across native/WASM CSS backends', category: 'build' },
    { name: 'minify-xml', exercises: 'RegExp + string manipulation surface', category: 'parse' },
    { name: 'pkg-types', exercises: 'fs + JSON for package.json/tsconfig.json', category: 'fs' },
    { name: 'cosmiconfig', exercises: 'Dynamic ESM import() with file:// URLs', category: 'fs' },
    { name: 'gettext-parser', exercises: 'Binary buffer + endianness, fs URL paths', category: 'parse' },

    { name: 'effect', exercises: 'Fiber runtime: timers, AbortSignal, finalizers, fs conformance', category: 'core' },
    { name: 'execa', exercises: 'child_process spawn/exec + stream pipes', category: 'process' },
    { name: 'yargs', exercises: 'events, util, process.argv, ESM-import wiring', category: 'process' },

    { name: 'axios', exercises: 'http, https, zlib, stream', category: 'network' },
    { name: 'socket.io', exercises: 'http, fetch raw body, IncomingMessage close', category: 'network' },
    { name: 'autobahn', exercises: 'RFC 6455 WebSocket fuzz (510 OK / 0 FAIL)', category: 'network' },

    { name: 'streamx', exercises: 'queueMicrotask scheduling, pipeline correctness', category: 'stream' },
    { name: 'worker-stress', exercises: 'worker_threads transferList, MessageChannel throughput', category: 'stream' },

    { name: 'mcp-typescript-sdk', exercises: 'MCP SDK against @gjsify/* end-to-end', category: 'network' },
    { name: 'mcp-inspector-cli', exercises: '@modelcontextprotocol/inspector vs net-mcp-server', category: 'network' },

    { name: 'ts-for-gir', exercises: '@gi.ts/parser against GIR fixtures', category: 'build' },

    { name: 'webtorrent', exercises: 'fs URL paths, stream, events, buffer, crypto', category: 'p2p' },
];

export const categoryLabels: Record<IntegrationSuite['category'], string> = {
    build: 'Build tooling',
    network: 'Networking',
    stream: 'Streams & workers',
    fs: 'Filesystem',
    parse: 'Parsing',
    process: 'Process & CLI',
    core: 'Language core',
    p2p: 'Peer-to-peer',
    'test-harness': 'Test harness',
};

export function groupIntegrationsByCategory(): Map<string, IntegrationSuite[]> {
    const grouped = new Map<string, IntegrationSuite[]>();
    for (const suite of integrationSuites) {
        const label = categoryLabels[suite.category];
        if (!grouped.has(label)) grouped.set(label, []);
        grouped.get(label)!.push(suite);
    }
    return grouped;
}
