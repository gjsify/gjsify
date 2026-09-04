// The measuring half of `react-native-devtools`, run as
// `dbus-run-session -- node driver.mjs <bundle> <env|option>`.
//
// A separate process because the whole measurement has to happen INSIDE a private
// session bus: the app claims a well-known name, and a bus left over from another
// run owns it already. `dbus-run-session` can only wrap a command, so the command
// is this file.
//
// JavaScript rather than the shell driver `devtools-export` embeds, because this
// suite CLICK-DRIVES: the widget path of the button is computed from `DumpTree`'s
// JSON, which is what every external caller has to do (a positional path written
// into a script is wrong the moment a widget is inserted above it). Doing that in
// bash would mean parsing JSON in bash.
//
// It prints ONE line, `RESULT=<json>`, and never asserts: every judgement belongs
// to `run.mjs`, so a failure names what was measured rather than where.

import { spawn, spawnSync } from 'node:child_process';

const [bundle, mode] = process.argv.slice(2);
const DEST = 'org.gjsify.RnDevtoolsProbe';
const BASE = '/org/gjsify/RnDevtoolsProbe';
const DEVTOOLS = `${BASE}/devtools`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `gdbus` output as text, with a generous buffer: `Screenshot` prints every byte. */
function gdbus(args, maxBuffer = 64 * 1024 * 1024) {
    const r = spawnSync('gdbus', args, { encoding: 'utf8', maxBuffer, timeout: 60 * 1000 });
    return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

const call = (method, ...args) =>
    gdbus([
        'call',
        '--session',
        '--dest',
        DEST,
        '--object-path',
        DEVTOOLS,
        '--method',
        `org.gjsify.Devtools.${method}`,
        ...args,
    ]);

/** `('<json>',)` — the shape every JSON-returning devtools method replies with. */
function unwrapJson(reply) {
    const match = /^\('(.*)',\)\s*$/s.exec(reply);
    if (match === null) return null;
    try {
        return JSON.parse(match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    } catch {
        // A real throw path: a devtools method can reply with a GDBus error string
        // instead of its payload, and `JSON.parse` raises on it. `null` here lets
        // `run.mjs` fail on the ABSENT measurement, with the app log beside it,
        // rather than the driver dying and reporting no RESULT line at all.
        return null;
    }
}

/** Depth-first search for the node whose `Gtk.Widget:name` a `testID` set. */
function findByName(node, name) {
    if (node === null || node === undefined) return null;
    if (node.name === name) return node;
    for (const child of node.children ?? []) {
        const hit = findByName(child, name);
        if (hit !== null) return hit;
    }
    return null;
}

const env = { ...process.env };
delete env.GJSIFY_DEVTOOLS;
delete env.PROBE_DEVTOOLS_OPTION;
if (mode === 'option') env.PROBE_DEVTOOLS_OPTION = '1';
else env.GJSIFY_DEVTOOLS = '1';

const child = spawn('gjs', ['-m', bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (chunk) => {
    log += chunk;
});
child.stderr.on('data', (chunk) => {
    log += chunk;
});

const result = { mode, onBus: false, iface: false };
for (let i = 0; i < 120; i++) {
    if (gdbus(['introspect', '--session', '--dest', DEST, '--object-path', BASE]).includes('interface')) {
        result.onBus = true;
        break;
    }
    await sleep(250);
}

if (result.onBus) {
    // The window is presented from `activate`, which can land a beat after the bus
    // name. Poll the fact the suite asserts rather than sleeping a fixed time.
    for (let i = 0; i < 40; i++) {
        const status = unwrapJson(call('GetStatus'));
        if (status?.activeWindow?.mapped === true) break;
        await sleep(250);
    }
    result.iface = gdbus(['introspect', '--session', '--dest', DEST, '--object-path', DEVTOOLS]).includes(
        'interface org.gjsify.Devtools',
    );
    result.status = unwrapJson(call('GetStatus'));
    result.tree = unwrapJson(call('DumpTree', '', '0'));
    const shot = call('Screenshot', '');
    // The PNG signature and the DECODED byte count, not the printed length: an
    // unmapped window answers `(@ay [],)`, a successful call returning no picture,
    // and a floor on printed characters would drift with `gdbus`' formatting.
    result.screenshot = {
        bytes: (shot.match(/0x/g) ?? []).length,
        png: shot.startsWith('([byte 0x89, 0x50, 0x4e, 0x47'),
    };

    const button = findByName(result.tree, 'probe-button');
    const label = findByName(result.tree, 'probe-label');
    result.buttonPath = button?.path ?? null;
    result.labelPath = label?.path ?? null;
    if (result.buttonPath !== null && result.labelPath !== null) {
        result.labelBefore = unwrapJson(call('GetProperty', result.labelPath, 'label'));
        result.activated = call('ActivateWidget', result.buttonPath).includes('true');
        // React commits the state update on a microtask; the label it writes lands
        // in the same turn, but the read is a fresh DBus round trip either way.
        await sleep(500);
        result.labelAfter = unwrapJson(call('GetProperty', result.labelPath, 'label'));
    }
}

child.kill('SIGTERM');
await sleep(300);
child.kill('SIGKILL');
result.log = log;
process.stdout.write(`RESULT=${JSON.stringify(result)}\n`);
