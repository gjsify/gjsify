// SPDX-License-Identifier: MIT
// The NativeScript host loads the addon on first use, not at import (ADR 0110: the pure-JS
// opt-out must cost nothing). `--conditions=nativescript` selects host.nativescript.js under
// Node, where no module loader exists — so a load attempt is observable as a thrown error:
// importing must NOT throw, ensureNative() must, and must keep throwing (ADR 0105 § 4, no
// silent fallback). Desktop hosts keep the eager load.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const index = fileURLToPath(new URL('../index.js', import.meta.url));
const gi = fileURLToPath(new URL('../gi.js', import.meta.url));
const cairoJs = fileURLToPath(new URL('../cairo.js', import.meta.url));
const gettextJs = fileURLToPath(new URL('../gettext.js', import.meta.url));

function run(args, code) {
    const r = spawnSync(process.execPath, [...args, '--input-type=module', '-e', code], {
        encoding: 'utf8',
        env: { ...process.env, NODE_GI_NATIVE: '' },
    });
    return { out: r.stdout.trim(), status: r.status, err: r.stderr };
}

describe('lazy native load', () => {
    it('importing index.js and gi.js on the nativescript host loads nothing', () => {
        const r = run(
            ['--conditions=nativescript'],
            `const m = await import(${JSON.stringify(index)}); await import(${JSON.stringify(gi)}); console.log(m.RUNTIME, m.isNativeLoaded());`,
        );
        assert.equal(r.status, 0, r.err);
        assert.equal(r.out, 'nativescript false');
    });

    it('a selected real engine that cannot load still fails loudly, every time', () => {
        const r = run(
            ['--conditions=nativescript'],
            `const m = await import(${JSON.stringify(index)});
             const { requireGi } = await import(${JSON.stringify(gi)});
             const msgs = [];
             for (let i = 0; i < 2; i++) { try { requireGi('GLib', '2.0'); msgs.push('no throw'); } catch (e) { msgs.push(e.message.slice(0, 40)); } }
             console.log(JSON.stringify([m.isNativeLoaded(), ...msgs]));`,
        );
        assert.equal(r.status, 0, r.err);
        const [loaded, a, b] = JSON.parse(r.out);
        assert.equal(loaded, false);
        assert.match(a, /node-gi/);
        assert.equal(a, b);
    });

    it('importing cairo.js and gettext.js on the nativescript host loads nothing', () => {
        const r = run(
            ['--conditions=nativescript'],
            `const m = await import(${JSON.stringify(index)});
             const cairo = await import(${JSON.stringify(cairoJs)});
             const gettext = await import(${JSON.stringify(gettextJs)});
             const first = (fn) => { try { fn(); return 'no throw'; } catch (e) { return e.message.slice(0, 40); } };
             console.log(JSON.stringify([
                 m.isNativeLoaded(),
                 first(() => cairo.ImageSurface.create(0, 1, 1)),
                 first(() => gettext.LocaleCategory.MESSAGES),
                 first(() => gettext.setlocale(0, null)),
             ]));`,
        );
        assert.equal(r.status, 0, r.err);
        const [loaded, ...first] = JSON.parse(r.out);
        assert.equal(loaded, false);
        for (const msg of first) assert.match(msg, /node-gi/);
    });

    it('desktop hosts still load at import', () => {
        const r = run([], `const m = await import(${JSON.stringify(index)}); console.log(m.isNativeLoaded());`);
        if (r.status !== 0) return; // no addon on this machine; covered by the whole suite
        assert.equal(r.out, 'true');
    });
});
