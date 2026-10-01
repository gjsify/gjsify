// @gjsify/devtools-mcp — the argv surface of the control plane, driven against a FAKE client.
//
// WHAT THIS CANNOT REACH, said rather than implied: every case here injects a client through
// `RunDevtoolsCliOptions.createClient`, so no method is put on a real wire and no real reply is
// parsed — the live transport is `dbus-client.spec.ts`'s job. What this suite pins is the half a
// shell script actually depends on: that an operation the app cannot satisfy exits NON-ZERO, that a
// no-match or an empty capture fails instead of printing something the caller would read as
// success, and that the size `shot` prints is the one in the PNG rather than the one requested.

import GLib from '@girs/glib-2.0';
import { describe, expect, it } from '@gjsify/unit';

import { type DevtoolsCliClient, runDevtoolsCli } from './cli.js';

/** One recorded `control()` call: the method, the reply type asked for, the params unpacked. */
interface Call {
    method: string;
    replyType: string | null;
    params: unknown[];
}

/** Per-method answers; an array is consumed one call at a time, the last entry repeating. */
type Answers = Record<string, unknown | unknown[]>;

/**
 * A `DevtoolsCliClient` stand-in. `unanswerable` lists the methods that throw, which is what an
 * app that is not running looks like — the reason `waitForControlPlane` exists.
 */
class FakeClient implements DevtoolsCliClient {
    readonly calls: Call[] = [];
    readonly unanswerable = new Set<string>();
    private readonly cursors = new Map<string, number>();

    constructor(private readonly answers: Answers = {}) {}

    describeTarget(): string {
        return 'fake app';
    }

    listInstances(): Promise<unknown[]> {
        return Promise.resolve([{ instance: 'default' }]);
    }

    jsonCall(_instance: string | undefined, method: string, params: GLib.Variant | null): Promise<string> {
        this.record(method, null, params);
        return Promise.resolve(JSON.stringify(this.answer(method)));
    }

    control(
        _instance: string | undefined,
        method: string,
        params: GLib.Variant | null,
        replyType: string | null,
    ): Promise<GLib.Variant> {
        this.record(method, replyType, params);
        if (this.unanswerable.has(method)) {
            return Promise.reject(new Error(`The name ${method} was not provided by any .service files`));
        }
        const value = this.answer(method);
        return Promise.resolve(variantFor(replyType, value));
    }

    /** Method names in call order — how "did it dispatch anything at all" is answered. */
    methodsCalled(): string[] {
        return this.calls.map((call) => call.method);
    }

    firstCall(method: string): Call | undefined {
        return this.calls.find((call) => call.method === method);
    }

    private record(method: string, replyType: string | null, params: GLib.Variant | null): void {
        this.calls.push({
            method,
            replyType,
            params: params ? (params.recursiveUnpack() as unknown[]) : [],
        });
    }

    private answer(method: string): unknown {
        if (!(method in this.answers)) throw new Error(`FakeClient has no answer for ${method}`);
        const answer = this.answers[method];
        if (!Array.isArray(answer)) return answer;
        const at = this.cursors.get(method) ?? 0;
        this.cursors.set(method, at + 1);
        return answer[Math.min(at, answer.length - 1)];
    }
}

function variantFor(replyType: string | null, value: unknown): GLib.Variant {
    switch (replyType) {
        case '(s)':
            return GLib.Variant.new_tuple([GLib.Variant.new_string(value as string)]);
        case '(b)':
            return GLib.Variant.new_tuple([GLib.Variant.new_boolean(value as boolean)]);
        case '(ii)':
            return GLib.Variant.new_tuple([
                GLib.Variant.new_int32((value as number[])[0]),
                GLib.Variant.new_int32((value as number[])[1]),
            ]);
        case '(ay)':
            // `new '(ay)'` rather than a `new_tuple` of children: it is how the app side builds
            // the reply (`devtools-service.ts`), so the fake hands back the same shape.
            return new GLib.Variant('(ay)', [value as Uint8Array]);
        default:
            return GLib.Variant.new_tuple([]);
    }
}

/** A PNG header carrying `width`×`height` — enough for `pngSize` to report a picture. */
function fakePng(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(32);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

function tmpPath(name: string): string {
    return GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-devtools-cli-${name}`]);
}

function exists(path: string): boolean {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

/** What one run printed, plus the exit code — the two things a shell caller can see. */
interface Run {
    code: number;
    out: string;
    err: string;
    client: FakeClient;
}

/**
 * Run the CLI with `console` swallowed and returned.
 *
 * stdout is the RESULT here (a path, a widget path, JSON), so a test asserting on it has to own
 * the printing rather than let it land in the runner's report.
 */
async function runCli(argv: readonly string[], answers: Answers = {}, opts: { silent?: string[] } = {}): Promise<Run> {
    const client = new FakeClient(answers);
    for (const method of opts.silent ?? []) client.unanswerable.add(method);
    const out: string[] = [];
    const err: string[] = [];
    const saved = { log: console.log, error: console.error };
    let code: number;
    try {
        console.log = (...args: unknown[]) => out.push(args.map(String).join(' '));
        console.error = (...args: unknown[]) => err.push(args.map(String).join(' '));
        code = await runDevtoolsCli(argv, {
            createClient: () => client,
        });
    } finally {
        console.log = saved.log;
        console.error = saved.error;
    }
    return { code, out: out.join('\n'), err: err.join('\n'), client };
}

const BUS = ['--bus-name', 'eu.example.App', '--timeout', '0'];

export default async () => {
    await describe('runDevtoolsCli — help and argument errors exit before anything is dialled', async () => {
        await it('prints usage and exits 2 with no operation', async () => {
            const { code, out } = await runCli([]);
            expect(code).toBe(2);
            expect(out).toContain('usage: gjsify devtools');
        });

        await it('exits 0 for an explicit help', async () => {
            const { code, out } = await runCli(['help']);
            expect(code).toBe(0);
            expect(out).toContain('usage: gjsify devtools');
        });

        await it('exits 2 for an operation nobody implements', async () => {
            const { code, client } = await runCli(['rebuild', ...BUS]);
            expect(code).toBe(2);
            // Nothing was put on the wire: an unknown verb must not half-drive the app.
            expect(client.methodsCalled()).toEqual([]);
        });

        await it('refuses to run with no app to talk to', async () => {
            const { code, err } = await runCli(['status', '--timeout', '0']);
            expect(code).toBe(2);
            expect(err).toContain('--bus-name');
        });
    });

    await describe('runDevtoolsCli shot — a file, and the size the file carries', async () => {
        await it('writes the PNG and prints the size the bytes carry', async () => {
            const path = tmpPath('shot.png');
            const run = await runCli(['shot', path, ...BUS], { Screenshot: fakePng(1100, 900) });
            expect(run.code).toBe(0);
            // The number a rig must not take from the resize request: 1280 asked, 1100 in the file.
            expect(run.out).toContain('1100×900');
            expect(GLib.file_get_contents(path)[0]).toBe(true);
        });

        await it('forwards --scope as the Screenshot argument', async () => {
            const run = await runCli(['shot', tmpPath('scope.png'), '--scope', '/0/1', ...BUS], {
                Screenshot: fakePng(200, 100),
            });
            expect(run.code).toBe(0);
            expect(run.client.firstCall('Screenshot')?.params).toEqual(['/0/1']);
        });

        await it('retries an empty answer and keeps the first real picture', async () => {
            const run = await runCli(['shot', tmpPath('retry.png'), '--retries', '3', ...BUS], {
                Screenshot: [new Uint8Array(0), new Uint8Array(0), fakePng(640, 480)],
            });
            expect(run.code).toBe(0);
            expect(run.client.methodsCalled().filter((m) => m === 'Screenshot').length).toBe(3);
            expect(run.out).toContain('640×480');
        });

        await it('exits 1 and writes no file when the app never answers with bytes', async () => {
            const path = tmpPath('empty.png');
            const run = await runCli(['shot', path, '--retries', '1', ...BUS], { Screenshot: new Uint8Array(0) });
            expect(run.code).toBe(1);
            expect(run.err).toContain('shot');
            // The failure that started all this: a 0-byte `.png` reported as a screenshot.
            expect(exists(path)).toBe(false);
        });
    });

    await describe('runDevtoolsCli — a refusal is a non-zero exit, not an empty line', async () => {
        await it('prints the widget path find resolved', async () => {
            const run = await runCli(['find', 'Adw.StatusPage:error', ...BUS], {
                FindWidget: '/Bauplaner/window/1/status',
            });
            expect(run.code).toBe(0);
            expect(run.out).toBe('/Bauplaner/window/1/status');
            expect(run.client.firstCall('FindWidget')?.params).toEqual(['Adw.StatusPage:error']);
        });

        await it('exits 1 when nothing matches the selector', async () => {
            const run = await runCli(['find', 'Adw.StatusPage:error', ...BUS], { FindWidget: '' });
            expect(run.code).toBe(1);
            expect(run.err).toContain('no visible widget');
            expect(run.out).toBe('');
        });

        await it('exits 1 when the widget has no activation', async () => {
            const run = await runCli(['activate', '/0/1', ...BUS], { ActivateWidget: false });
            expect(run.code).toBe(1);
            expect(run.err).toContain('no default activation');
        });

        await it('exits 1 when a key goes nowhere', async () => {
            const run = await runCli(['key', '<Control>s', '/0/1', ...BUS], { SendKey: false });
            expect(run.code).toBe(1);
            expect(run.err).toContain('<Control>s');
        });

        await it('exits 1 on a bus error instead of printing a stack', async () => {
            const run = await runCli(['status', ...BUS], {}, { silent: ['GetStatus'] });
            expect(run.code).toBe(1);
            expect(run.err).toContain('gjsify devtools status');
        });
    });

    await describe('runDevtoolsCli — the JSON operations print what the app answered', async () => {
        await it('prints status JSON', async () => {
            const run = await runCli(['status', ...BUS], { GetStatus: { alive: true, extensions: ['cdp'] } });
            expect(run.code).toBe(0);
            expect(run.out).toContain('"alive":true');
        });

        await it('asks DumpTree for a bounded depth', async () => {
            const run = await runCli(['tree', '--depth', '3', ...BUS], { DumpTree: { nodes: [] } });
            expect(run.code).toBe(0);
            expect(run.client.firstCall('DumpTree')?.params).toEqual(['', 3]);
        });

        await it('lists the reachable instances', async () => {
            const run = await runCli(['instances', ...BUS]);
            expect(run.code).toBe(0);
            expect(run.out).toContain('default');
        });
    });

    await describe('runDevtoolsCli — readiness is polled, never slept on', async () => {
        await it('waits for GetStatus to answer before it dispatches', async () => {
            const run = await runCli(['status', '--bus-name', 'eu.example.App', '--timeout', '2'], {
                GetStatus: { alive: true },
            });
            expect(run.code).toBe(0);
            expect(run.client.firstCall('GetStatus')?.method).toBe('GetStatus');
        });

        await it('gives up with a named diagnosis when the app never exports the plane', async () => {
            const run = await runCli(
                ['status', '--bus-name', 'eu.example.App', '--timeout', '1'],
                {},
                {
                    silent: ['GetStatus'],
                },
            );
            expect(run.code).toBe(1);
            expect(run.err).toContain('GetStatus');
            expect(run.err).toContain('GJSIFY_DEVTOOLS');
        });
    });
};
