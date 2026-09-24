// SPDX-License-Identifier: MIT
// win32: the batteries-included windowing bundle gives GTK a real OpenGL (#1097).
//
// The runner this is written for has no GPU and no OpenGL ICD, so the host offers only the
// GDI generic OpenGL 1.1 that GDK rejects. Before the bundle carried Mesa, this process got
// exactly that: `Gdk.Display.create_gl_context()` read "No GL implementation is available",
// every Gtk.GLArea painted that string, and GSK quietly fell back to cairo — invisible to
// every other Windows leg, all of which pin GSK_RENDERER=cairo.
//
// The last case is the discriminator. It re-runs the same probe in a child told to keep the
// host's OpenGL (`GJSIFY_OPENGL=system`), which is precisely what a bundle WITHOUT Mesa does,
// and requires it to fail where this process succeeded. So a green run cannot mean the host
// happened to have GL: the only thing varied between the two is the preload.
//
// Run WITHOUT GSK_RENDERER — the renderer GSK picks on its own is part of the claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGLStrings, probeHostOpenGL } from '../index.js';
import { requireGi } from '../gi.js';
import { openGLActivation, resolveGtkRuntimeBundle } from '../gtk-runtime.js';

const here = dirname(fileURLToPath(import.meta.url));
const skip = process.platform !== 'win32' ? 'win32 only — elsewhere the OpenGL is the host system’s' : false;

// GTK 4.22's GL renderer needs 3.2 core on WGL; below that GDK refuses the context.
const MIN_GL = [3, 2];

/** Realize a GL context on the default display; returns what it got, or the error text. */
function probeGL(Gdk) {
    try {
        const ctx = Gdk.Display.get_default().create_gl_context();
        ctx.realize();
        ctx.make_current();
        const [major, minor] = ctx.get_version();
        const strings = currentGLStrings();
        Gdk.GLContext.clear_current();
        return { ok: true, major, minor, es: ctx.get_use_es(), strings };
    } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
    }
}

test('the windowing bundle ships a GL implementation and the loader preloads it', { skip }, () => {
    const bundle = resolveGtkRuntimeBundle();
    assert.ok(bundle, 'no GTK runtime bundle resolved — this proof needs the windowing bundle staged');
    const host = probeHostOpenGL();
    const activation = openGLActivation();
    console.log(`host OpenGL: ${JSON.stringify(host)}; decision: ${JSON.stringify(activation)}`);
    assert.ok(activation, 'activateBundledOpenGL did not apply — is opengl32.dll missing from the bundle?');
    if (host.wddmIcd || host.registryIcd) {
        // A host with a real ICD keeps it; the rest of this file then measures that driver.
        assert.equal(activation.source, 'system');
        return;
    }
    assert.equal(activation.source, 'bundle', activation.reason);
    assert.equal(
        resolve(activation.loadedFrom).toLowerCase(),
        resolve(join(bundle.libDir, 'opengl32.dll')).toLowerCase(),
        'opengl32 in this process is not the bundled one',
    );
});

test('GDK realizes a desktop GL context of at least 3.2', { skip }, () => {
    const Gdk = requireGi('Gdk', '4.0');
    const Gtk = requireGi('Gtk', '4.0');
    Gtk.init();
    const gl = probeGL(Gdk);
    console.log(`GL: ${JSON.stringify(gl)}`);
    assert.ok(gl.ok, `GL context failed: ${gl.error}`);
    assert.ok(
        gl.major > MIN_GL[0] || (gl.major === MIN_GL[0] && gl.minor >= MIN_GL[1]),
        `GL ${gl.major}.${gl.minor} is below ${MIN_GL.join('.')}`,
    );
    assert.ok(gl.strings, 'no GL strings from the current context');
    assert.doesNotMatch(gl.strings.renderer, /GDI Generic/, 'the context is the GDI generic OpenGL 1.1');
});

test(
    'GSK picks a GL renderer on its own',
    { skip: skip || (process.env.GSK_RENDERER && 'GSK_RENDERER is set') },
    () => {
        const Gtk = requireGi('Gtk', '4.0');
        const GObject = requireGi('GObject', '2.0');
        Gtk.init();
        const win = new Gtk.Window({ default_width: 64, default_height: 64 });
        win.realize();
        const renderer = GObject.type_name(win.get_renderer().constructor.$gtype);
        console.log(`GSK renderer: ${renderer}`);
        win.destroy();
        assert.notEqual(renderer, 'GskCairoRenderer', 'GSK fell back to cairo — it found no usable GL');
    },
);

test('the same probe keeping the host OpenGL fails — the preload is what made it pass', { skip }, () => {
    const host = probeHostOpenGL();
    if (host.wddmIcd || host.registryIcd) return; // a real driver: there is no "before" to show
    const script = `
        import { requireGi } from ${JSON.stringify(new URL('../gi.js', import.meta.url).href)};
        import { openGLActivation } from ${JSON.stringify(new URL('../gtk-runtime.js', import.meta.url).href)};
        const Gdk = requireGi('Gdk', '4.0');
        requireGi('Gtk', '4.0').init();
        let out;
        try {
            const ctx = Gdk.Display.get_default().create_gl_context();
            ctx.realize();
            out = { ok: true, version: ctx.get_version() };
        } catch (e) {
            out = { ok: false, error: String(e?.message ?? e) };
        }
        console.log(JSON.stringify({ activation: openGLActivation(), ...out }));
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: here,
        env: { ...process.env, GJSIFY_OPENGL: 'system' },
        encoding: 'utf8',
    });
    const line = res.stdout.trim().split(/\r?\n/).pop() ?? '';
    console.log(`child (GJSIFY_OPENGL=system): ${line}\n${res.stderr.trim()}`);
    const child = JSON.parse(line);
    assert.equal(child.activation?.source, 'system');
    assert.equal(
        child.ok,
        false,
        `the host OpenGL realized a context (${child.version}) — this runner is not GPU-less`,
    );
    assert.match(child.error, /No GL implementation|OpenGL|GL/i);
});
