// Integration test suites under `tests/integration/*`.
//
// Each entry runs an npm package's real test suite (or a curated subset)
// against `@gjsify/*` — proving "this real-world library works on GJS,
// not just our own polyfill tests".
//
// We show this as a list/grid, not as a progress bar — there's no
// comparable "all npm packages" denominator. The value is "look at the
// breadth of what already runs".

export interface IntegrationSuite {
    /** npm package being exercised */
    name: string;
    /** What gjsify surface is validated */
    exercises: string;
    /** Quick categorisation for grouping in the UI */
    category: 'build' | 'network' | 'stream' | 'fs' | 'parse' | 'process' | 'core' | 'p2p' | 'test-harness';
    /** GJS-only when it requires native bridges that don't load on Node */
    gjsOnly?: boolean;
}

export const integrationSuites: readonly IntegrationSuite[] = [
    // Core language & parser canaries
    { name: 'acorn', exercises: 'ESM parser / AST — SpiderMonkey 140 canary', category: 'parse' },
    { name: 'deepkit-type-compiler', exercises: 'TypeScript reflection emitter', category: 'build' },

    // Build tooling
    { name: 'rolldown-native', exercises: 'Native Vala/Rolldown plugin bridge', category: 'build', gjsOnly: true },
    { name: 'rollup-pluginutils', exercises: 'Path + glob (picomatch)', category: 'build' },
    { name: 'fast-glob', exercises: 'fs URL paths, readdir/stat/lstat, symlinks', category: 'fs' },
    { name: 'lightningcss', exercises: 'Byte-equality across native/WASM CSS backends', category: 'build' },
    { name: 'minify-xml', exercises: 'RegExp + string manipulation surface', category: 'parse' },
    { name: 'pkg-types', exercises: 'fs + JSON for package.json/tsconfig.json', category: 'fs' },
    { name: 'cosmiconfig', exercises: 'Dynamic ESM import() with file:// URLs', category: 'fs' },
    { name: 'gettext-parser', exercises: 'Binary buffer + endianness, fs URL paths', category: 'parse' },

    // Process + CLI
    { name: 'execa', exercises: 'child_process spawn/exec + stream pipes', category: 'process' },
    { name: 'yargs', exercises: 'events, util, process.argv, ESM-import wiring', category: 'process' },

    // Networking
    { name: 'axios', exercises: 'http, https, zlib, stream', category: 'network' },
    { name: 'socket.io', exercises: 'http, fetch raw body, IncomingMessage close', category: 'network' },
    { name: 'autobahn', exercises: 'RFC 6455 WebSocket fuzz (510 OK / 0 FAIL)', category: 'network' },

    // Streams
    { name: 'streamx', exercises: 'queueMicrotask scheduling, pipeline correctness', category: 'stream' },
    { name: 'worker-stress', exercises: 'worker_threads transferList, MessageChannel throughput', category: 'stream' },

    // MCP (Model Context Protocol)
    { name: 'mcp-typescript-sdk', exercises: 'MCP SDK against @gjsify/* end-to-end', category: 'network' },
    { name: 'mcp-inspector-cli', exercises: '@modelcontextprotocol/inspector vs net-mcp-server', category: 'network' },

    // Generators
    { name: 'ts-for-gir', exercises: '@gi.ts/parser against GIR fixtures', category: 'build' },

    // P2P / BitTorrent
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
