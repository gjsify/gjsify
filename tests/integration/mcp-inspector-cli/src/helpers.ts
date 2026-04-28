// Subprocess helpers for inspector-cli e2e tests.
// Both the MCP server (GJS or Node bundle of @gjsify/example-node-net-mcp-server)
// and the @modelcontextprotocol/inspector CLI are spawned out-of-process so that
// any native crash (SIGSEGV) is observable via exit code rather than masked by
// in-process catch blocks.

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

// Resolve the prebuilt example bundles via path math from this module's URL.
// `createRequire(...).resolve(...)` only works on Node; on the GJS harness it
// throws because GJS's module resolver cannot walk the workspace symlink graph
// of a bundled file. The bundle lives at `tests/integration/mcp-inspector-cli/
// dist/test.<runtime>.mjs`, four levels up from the example dist.
const _here = fileURLToPath(import.meta.url);
const _exampleDist = new URL('../../../../examples/node/net-mcp-server/dist/', `file://${_here}`);
export const SERVER_BUNDLES = {
  gjs: fileURLToPath(new URL('index.gjs.mjs', _exampleDist)),
  node: fileURLToPath(new URL('index.node.mjs', _exampleDist)),
} as const;

export type ServerTarget = keyof typeof SERVER_BUNDLES;

/** Bind ephemeral port, close, return the number — small race but acceptable for tests. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('No address from listen()'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

export interface RunningServer {
  proc: ChildProcess;
  port: number;
  baseUrl: string;
  /** Resolves once the process has exited. */
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stop(): Promise<void>;
  isAlive(): boolean;
}

/** Spawn the example MCP server, wait for the listening log line, return handle. */
export async function startServer(target: ServerTarget, opts: { startupTimeoutMs?: number } = {}): Promise<RunningServer> {
  const port = await getFreePort();
  const bundle = SERVER_BUNDLES[target];
  // For the GJS target we use `gjsify run` (not `gjs -m`) so that
  // LD_LIBRARY_PATH / GI_TYPELIB_PATH get auto-injected from every
  // workspace `@gjsify/*` package's `gjsify.prebuilds` field. Without
  // this the example fails to load the @gjsify/http-soup-bridge typelib.
  const cmd = target === 'gjs'
    ? new URL('../../../../node_modules/.bin/gjsify', import.meta.url).pathname
    : 'node';
  const args = target === 'gjs' ? ['run', bundle] : [bundle];

  const proc = spawn(cmd, args, {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  proc.stdout!.on('data', (b: Buffer) => { stdoutBuf += b.toString('utf8'); });
  proc.stderr!.on('data', (b: Buffer) => { stderrBuf += b.toString('utf8'); });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    proc.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const startupTimeoutMs = opts.startupTimeoutMs ?? 8000;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `${target} server did not log "listening" within ${startupTimeoutMs}ms.\n` +
        `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`,
      ));
    }, startupTimeoutMs);
    const check = setInterval(() => {
      if (stdoutBuf.includes('listening')) {
        clearTimeout(timer); clearInterval(check); resolve();
      } else if (proc.exitCode !== null) {
        clearTimeout(timer); clearInterval(check);
        reject(new Error(
          `${target} server exited with code=${proc.exitCode} before listening.\n` +
          `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`,
        ));
      }
    }, 50);
  });
  await ready;

  return {
    proc,
    port,
    baseUrl: `http://localhost:${port}/mcp`,
    exit,
    isAlive: () => proc.exitCode === null && proc.signalCode === null,
    async stop() {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      proc.kill('SIGTERM');
      // Force-kill after 2 s if needed.
      const killed = await Promise.race([
        exit.then(() => true),
        new Promise<false>(r => setTimeout(() => r(false), 2000)),
      ]);
      if (!killed) {
        proc.kill('SIGKILL');
        await exit;
      }
    },
  };
}

export interface InspectorResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Parsed JSON from stdout, or `undefined` if not parseable. */
  json: unknown | undefined;
}

/**
 * Run the @modelcontextprotocol/inspector CLI as a subprocess. The positional
 * `target` (server URL) must come BEFORE the option flags — `--tool-arg` is
 * variadic in the inspector's commander config, so any positional placed after
 * it would be consumed as another tool-arg value (verified empirically).
 */
export function runInspector(serverUrl: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<InspectorResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  return new Promise((resolve) => {
    const proc = spawn('npx', ['-y', '@modelcontextprotocol/inspector', serverUrl, '--cli', '--transport', 'http', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout!.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    proc.stderr!.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.once('exit', (code) => {
      clearTimeout(timer);
      let json: unknown | undefined;
      try { json = JSON.parse(stdout); } catch { /* not JSON */ }
      resolve({ exitCode: code, stdout, stderr, json });
    });
  });
}
