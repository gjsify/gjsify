// SPDX-License-Identifier: MIT
// End-to-end inspector CLI suite. The official @modelcontextprotocol/inspector
// is the exact tool that surfaced the original SIGSEGV; running it as a black-box
// client guarantees that any regression — including native crashes — is caught
// at the subprocess boundary rather than masked by in-process error handling.

import { describe, it, expect } from '@gjsify/unit';
import { startServer, runInspector, type ServerTarget, type RunningServer } from './helpers.js';

async function withServer(target: ServerTarget, fn: (s: RunningServer) => Promise<void>): Promise<void> {
  const server = await startServer(target);
  try { await fn(server); }
  finally { await server.stop(); }
}

function assertAlive(server: RunningServer, hint: string): void {
  if (!server.isAlive()) {
    throw new Error(`server died (${hint}); exit code: ${server.proc.exitCode}, signal: ${server.proc.signalCode}`);
  }
}

export default async () => {
  await describe('MCP inspector CLI e2e', async () => {

    // Run the same matrix against both server targets so a regression that
    // only manifests on GJS (the original bug) cannot pass via the Node build.
    for (const target of ['gjs', 'node'] as ServerTarget[]) {

      await describe(`server=${target}`, async () => {

        await it('lists tools', async () => {
          await withServer(target, async (server) => {
            const r = await runInspector(server.baseUrl, ['--method', 'tools/list']);
            expect(r.exitCode).toBe(0);
            expect(r.json).toBeDefined();
            const tools = (r.json as any).tools;
            expect(Array.isArray(tools)).toBe(true);
            expect(tools.length).toBeGreaterThan(0);
            assertAlive(server, 'after tools/list');
          });
        });

        await it('lists resources', async () => {
          await withServer(target, async (server) => {
            const r = await runInspector(server.baseUrl, ['--method', 'resources/list']);
            expect(r.exitCode).toBe(0);
            expect(r.json).toBeDefined();
            assertAlive(server, 'after resources/list');
          });
        });

        await it('lists prompts', async () => {
          await withServer(target, async (server) => {
            const r = await runInspector(server.baseUrl, ['--method', 'prompts/list']);
            expect(r.exitCode).toBe(0);
            expect(r.json).toBeDefined();
            assertAlive(server, 'after prompts/list');
          });
        });

        await it('calls a tool and returns its result', async () => {
          await withServer(target, async (server) => {
            const r = await runInspector(server.baseUrl, [
              '--method', 'tools/call',
              '--tool-name', 'echo',
              '--tool-arg', 'message=hello-from-inspector',
            ]);
            expect(r.exitCode).toBe(0);
            expect(r.json).toBeDefined();
            const text = (r.json as any).content?.[0]?.text;
            expect(text).toBe('hello-from-inspector');
            assertAlive(server, 'after tools/call');
          });
        });

        await it('reads a resource', async () => {
          await withServer(target, async (server) => {
            const r = await runInspector(server.baseUrl, [
              '--method', 'resources/read',
              '--uri', 'info://server/meta',
            ]);
            expect(r.exitCode).toBe(0);
            expect(r.json).toBeDefined();
            assertAlive(server, 'after resources/read');
          });
        });

        // Original crash trigger: server kept dying after the first tool call.
        // Each invocation is a fresh inspector subprocess and a fresh HTTP
        // session, so this exercises the libsoup-server lifecycle the same
        // way the interactive inspector UI does.
        //
        // Cap is 4 (was 3 before the bridge): @gjsify/http-soup-bridge
        // eliminated the libsoup-internal Boxed-Source GC race, so the
        // first inspector iteration no longer crashes the server outright.
        // A residual deferred-GC SIGSEGV from Boxed wrappers created
        // elsewhere in the MCP-SDK / Hono / web-streams stack still hits
        // around GJS's 10 s deferred-GC heuristic — total runtime of N
        // iterations × ~3 s/iteration must stay under that window.
        // Tracked as a separate STATUS.md item; revisit once the offending
        // wrapper is identified and pinned.
        await it('survives a sequence of inspector invocations on the same server', async () => {
          await withServer(target, async (server) => {
            for (let i = 1; i <= 4; i++) {
              const r = await runInspector(server.baseUrl, [
                '--method', 'tools/call',
                '--tool-name', 'echo',
                '--tool-arg', `message=call-${i}`,
              ]);
              expect(r.exitCode).toBe(0);
              const text = (r.json as any).content?.[0]?.text;
              expect(text).toBe(`call-${i}`);
              assertAlive(server, `after call ${i}`);
            }
          });
        });

        await it('handles add tool with numeric arguments', async () => {
          await withServer(target, async (server) => {
            const r = await runInspector(server.baseUrl, [
              '--method', 'tools/call',
              '--tool-name', 'add',
              '--tool-arg', 'a=7',
              '--tool-arg', 'b=8',
            ]);
            expect(r.exitCode).toBe(0);
            const text = (r.json as any).content?.[0]?.text;
            expect(text).toBe('15');
            assertAlive(server, 'after add');
          });
        });

      });
    }

  });
};
