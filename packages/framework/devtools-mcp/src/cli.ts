// @gjsify/devtools-mcp — the SCRIPTABLE face of the control plane.
//
// `runDevtoolsMcp` is the right shape for an AI agent and the wrong one for a shell script: an
// MCP answer is base64 inside a JSON-RPC frame, so `Screenshot` cannot be piped into a file, and
// every consumer that wanted a screenshot on disk wrote its own GJS caller to unpack the `ay`
// variant. This is that caller, once, for everybody — the transport is the SAME
// `DbusDevtoolsClient` the MCP bridge uses, so the peer transport (macOS/Windows, which have no
// session bus) comes along with it instead of being the Linux-only half.
//
// What lives here is dispatch and EXIT CODES, nothing else: the wire details stay in the client,
// the two screenshot invariants (empty bytes are a failure, the size comes from the PNG) stay in
// `@gjsify/devtools/shot`, and every method name here is one the control plane already answers.

import GLib from '@girs/glib-2.0';
import { captureShot } from '@gjsify/devtools/shot';

import { DbusDevtoolsClient } from './dbus-client.js';

/** Options every subcommand shares. */
export interface DevtoolsCliGlobalOptions {
    /** App DBus base name. Required — there is nothing to fall back to that is not a guess. */
    busName: string;
    address?: string;
    instance?: string;
    /** Seconds to poll `GetStatus` for before giving up; 0 means "do not wait". */
    timeout: number;
}

/**
 * The part of {@link DbusDevtoolsClient} this runner uses.
 *
 * Declared structurally rather than taking the class, so a caller can drive a control plane over
 * a transport of its own — and so the dispatch is testable without a bus, which is also the only
 * place a "refused" reply can be produced at all.
 */
export interface DevtoolsCliClient {
    describeTarget(label?: string): string;
    listInstances(): Promise<unknown[]>;
    jsonCall(instance: string | undefined, method: string, params?: GLib.Variant | null): Promise<string>;
    control(
        instance: string | undefined,
        method: string,
        params: GLib.Variant | null,
        replyType: string | null,
    ): Promise<GLib.Variant>;
}

/** Injection seam for {@link runDevtoolsCli}; unset means "dial a real app". */
export interface RunDevtoolsCliOptions {
    createClient?: (busName: string, address: string | undefined, instance: string | undefined) => DevtoolsCliClient;
}

interface ParsedArgv {
    operation: string;
    operands: string[];
    flags: Map<string, string>;
}

function usage(): string {
    return [
        'usage: gjsify devtools <operation> [operands] [options]',
        '',
        'operations:',
        '  shot [out.png]        Screenshot to a file; prints the size the PNG actually carries',
        '  find <selector>       first visible widget matching Type / :css-class / Type:css-class → its path',
        '  activate <path>       activate the widget at a widget path (exits 1 if it is inert)',
        '  key <accel> [path]    send a key to a path, or to the focused widget when omitted',
        '  tree [path]           dump the widget tree as JSON (--depth N, default 8)',
        '  property <path> <p>   read one GObject property off a widget',
        '  focused               the focused widget',
        '  toplevels             the live toplevel windows',
        '  resize <w> <h>        resize the active window (prints the size ASKED for — read the PNG for the real one)',
        '  present               raise + focus the active window',
        '  status                liveness + whatever extensions contribute',
        '  actions [scope name]  list the GActions, or activate scope.name',
        '  css [name]            list installed CSS providers, or install one (--file <css>)',
        '  gsettings <schema>    dump an installed GSettings schema',
        '  instances             reachable devtools-enabled instances',
        '',
        'options:',
        '  --bus-name <id>       app DBus base name (required unless package.json#gjsify.devtools.busNameBase)',
        '  --address <addr>      peer D-Bus address (unix:path=… / nonce-tcp:…) instead of the session bus',
        '  --instance <label>    instance label of a multi-instance app',
        '  --timeout <seconds>   poll GetStatus until the app answers (default 30; 0 = do not wait)',
        '  --scope <s>           shot: what to capture — "window" (default) or a widget path',
        '  --settle <ms>         shot: pause before the first capture',
        '  --retries <n>         shot: attempts after an empty answer (default 8)',
    ].join('\n');
}

function parseArgv(argv: readonly string[]): ParsedArgv {
    const operands: string[] = [];
    const flags = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!;
        if (!token.startsWith('--')) {
            operands.push(token);
            continue;
        }
        const eq = token.indexOf('=');
        if (eq !== -1) {
            flags.set(token.slice(2, eq), token.slice(eq + 1));
            continue;
        }
        const name = token.slice(2);
        const next = argv[i + 1];
        // A flag with no value is a boolean the caller set by naming it.
        if (next !== undefined && !next.startsWith('--')) {
            flags.set(name, next);
            i++;
        } else {
            flags.set(name, 'true');
        }
    }
    const [operation = '', ...rest] = operands;
    return { operation, operands: rest, flags };
}

function flagInt(flags: Map<string, string>, name: string, fallback: number): number {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/** Print a `(s)` answer as the JSON it is, pretty-printed, so a caller can pipe it into `jq`. */
async function printJson(
    client: DevtoolsCliClient,
    instance: string | undefined,
    method: string,
    params: GLib.Variant | null = null,
): Promise<void> {
    console.log(await client.jsonCall(instance, method, params));
}

async function firstString(reply: GLib.Variant): Promise<string> {
    const [value] = reply.recursiveUnpack() as [string];
    return value;
}

async function firstBoolean(reply: GLib.Variant): Promise<boolean> {
    const [value] = reply.recursiveUnpack() as [boolean];
    return value;
}

/**
 * Wait for the control plane to answer `GetStatus`.
 *
 * Polling rather than sleeping a fixed time is not a style preference: a cold start on a GPU-less
 * machine measured 94 s before the first call answered (1 s warm), so any fixed sleep is wrong in
 * one direction or the other. A single `GetStatus` that answers is the only cheap proof the
 * object is exported, which is what a caller actually has to wait for.
 */
async function waitForControlPlane(
    client: DevtoolsCliClient,
    instance: string | undefined,
    seconds: number,
): Promise<void> {
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    let lastError: unknown;
    do {
        try {
            await client.control(instance, 'GetStatus', null, '(s)');
            return;
        } catch (error) {
            lastError = error;
            await sleep(250);
        }
    } while (Date.now() < deadline);
    throw new Error(
        `${client.describeTarget()} did not answer GetStatus within ${seconds}s — ` +
            `is the app running with GJSIFY_DEVTOOLS=1? Last error: ${lastError}`,
    );
}

/**
 * Run one control-plane operation and return the process exit code.
 *
 * A subcommand that cannot do what was asked exits NON-ZERO, always. A rig whose capture step
 * reports success while handing on nothing is worse than one that fails, because the failure is
 * invisible until someone opens the file.
 */
async function runOperation(
    client: DevtoolsCliClient,
    instance: string | undefined,
    parsed: ParsedArgv,
): Promise<number> {
    const { operation, operands, flags } = parsed;
    const strv = (value: string) => GLib.Variant.new_string(value);

    switch (operation) {
        case 'shot': {
            const path = operands[0] ?? 'screenshot.png';
            const scope = flags.get('scope') ?? 'window';
            const result = await captureShot(
                async (what) => {
                    const reply = await client.control(
                        instance,
                        'Screenshot',
                        GLib.Variant.new_tuple([strv(what)]),
                        '(ay)',
                    );
                    return reply.get_child_value(0).deepUnpack() as Uint8Array;
                },
                path,
                scope,
                { settleMs: flagInt(flags, 'settle', 0), retries: flagInt(flags, 'retries', 8) },
            );
            // The size is the PNG's own, so a resize the window ignored is visible here and
            // only here — `resize` cannot report its own failure.
            console.log(`wrote ${result.path} (${result.byteLength} bytes, ${result.width}×${result.height})`);
            return 0;
        }

        case 'find': {
            const selector = operands[0];
            if (!selector) throw new Error('usage: gjsify devtools find <Type[:css-class]>');
            const found = await firstString(
                await client.control(instance, 'FindWidget', GLib.Variant.new_tuple([strv(selector)]), '(s)'),
            );
            // Empty is a FAILURE here, not an empty line: the whole point of resolving a path
            // by selector is to assert the widget is there before driving it.
            if (!found) {
                console.error(`no visible widget matches "${selector}"`);
                return 1;
            }
            console.log(found);
            return 0;
        }

        case 'activate': {
            const path = operands[0];
            if (!path) throw new Error('usage: gjsify devtools activate <widget-path>');
            const activated = await firstBoolean(
                await client.control(instance, 'ActivateWidget', GLib.Variant.new_tuple([strv(path)]), '(b)'),
            );
            if (!activated) {
                console.error(`ActivateWidget refused ${path} — it has no default activation`);
                return 1;
            }
            console.log(`activated ${path}`);
            return 0;
        }

        case 'key': {
            const [accelerator, path = ''] = operands;
            if (!accelerator) throw new Error('usage: gjsify devtools key <accel> [widget-path]');
            const delivered = await firstBoolean(
                await client.control(
                    instance,
                    'SendKey',
                    GLib.Variant.new_tuple([strv(accelerator), strv(path)]),
                    '(b)',
                ),
            );
            if (!delivered) {
                console.error(`${path || 'the focused widget'} has no key controller — "${accelerator}" went nowhere`);
                return 1;
            }
            console.log(`sent ${accelerator} to ${path || 'the focused widget'}`);
            return 0;
        }

        case 'tree': {
            const [root = ''] = operands;
            await printJson(
                client,
                instance,
                'DumpTree',
                GLib.Variant.new_tuple([strv(root), GLib.Variant.new_int32(flagInt(flags, 'depth', 8))]),
            );
            return 0;
        }

        case 'property': {
            const [path, prop] = operands;
            if (!path || !prop) throw new Error('usage: gjsify devtools property <widget-path> <property>');
            await printJson(client, instance, 'GetProperty', GLib.Variant.new_tuple([strv(path), strv(prop)]));
            return 0;
        }

        case 'focused':
            await printJson(client, instance, 'GetFocused');
            return 0;

        case 'toplevels':
            await printJson(client, instance, 'ListToplevels');
            return 0;

        case 'status':
            await printJson(client, instance, 'GetStatus');
            return 0;

        case 'resize': {
            const [width, height] = operands.map(Number);
            if (!Number.isFinite(width) || !Number.isFinite(height)) {
                throw new Error('usage: gjsify devtools resize <width> <height>');
            }
            await client.control(
                instance,
                'ResizeWindow',
                GLib.Variant.new_tuple([GLib.Variant.new_int32(width), GLib.Variant.new_int32(height)]),
                '(ii)',
            );
            console.log(`asked for ${width}×${height} — the app reports the size it was given, not the one it took`);
            return 0;
        }

        case 'present':
            await client.control(instance, 'PresentWindow', null, null);
            console.log('presented');
            return 0;

        case 'actions': {
            const [scope, name, value] = operands;
            if (!scope || !name) {
                await printJson(client, instance, 'ListActions');
                return 0;
            }
            await client.control(
                instance,
                'ActivateAction',
                GLib.Variant.new_tuple([strv(scope), strv(name), strv(value ?? '')]),
                null,
            );
            console.log(`activated ${scope}.${name}`);
            return 0;
        }

        case 'css': {
            const [name] = operands;
            const file = flags.get('file');
            if (!name || !file) {
                await printJson(client, instance, 'DumpCss');
                return 0;
            }
            const css = await readTextFile(file);
            const applied = await firstBoolean(
                await client.control(instance, 'SwapCss', GLib.Variant.new_tuple([strv(name), strv(css)]), '(b)'),
            );
            if (!applied) {
                console.error(`no display — CSS provider "${name}" was not applied`);
                return 1;
            }
            console.log(`applied CSS provider "${name}"`);
            return 0;
        }

        case 'gsettings': {
            const [schema] = operands;
            if (!schema) throw new Error('usage: gjsify devtools gsettings <schema>');
            await printJson(client, instance, 'DumpGSettings', GLib.Variant.new_tuple([strv(schema)]));
            return 0;
        }

        case 'instances':
            console.log(JSON.stringify(await client.listInstances(), null, 2));
            return 0;

        default:
            console.error(`unknown operation "${operation}"\n\n${usage()}`);
            return 2;
    }
}

/** Read a local file as text — Gio only, so the bundle needs no Node built-in. */
async function readTextFile(path: string): Promise<string> {
    const { default: Gio } = await import('@girs/gio-2.0');
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    if (!ok) throw new Error(`cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

/**
 * Entry point for the `gjsify devtools` client bundle: parse argv, connect, wait, dispatch.
 *
 * @returns the process exit code — 0 done, 1 the app said no, 2 the request itself was wrong.
 */
export async function runDevtoolsCli(argv: readonly string[], options: RunDevtoolsCliOptions = {}): Promise<number> {
    const parsed = parseArgv(argv);
    if (parsed.operation === '' || parsed.operation === 'help' || parsed.flags.get('help') === 'true') {
        console.log(usage());
        return parsed.operation === '' ? 2 : 0;
    }

    const busName = parsed.flags.get('bus-name');
    if (!busName) {
        console.error(
            'gjsify devtools: no app to talk to — pass --bus-name <org.example.App>, or set ' +
                'package.json#gjsify.devtools.busNameBase.\n',
        );
        return 2;
    }

    const address = parsed.flags.get('address');
    const instance = parsed.flags.get('instance');
    const client = options.createClient
        ? options.createClient(busName, address, instance)
        : new DbusDevtoolsClient(busName, { address, instance });

    try {
        await waitForControlPlane(client, instance, flagInt(parsed.flags, 'timeout', 30));
        return await runOperation(client, instance, parsed);
    } catch (error) {
        // One line naming the target, not a stack: this is a shell tool, and the useful part of
        // the failure is which app and which operation, both of which the stack buries.
        console.error(`gjsify devtools ${parsed.operation}: ${error instanceof Error ? error.message : error}`);
        return 1;
    }
}
