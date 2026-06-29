// E2E test for `gjsify storybook --runtime node` — the storybook-on-Node
// milestone (Axis-5 reverse bridge).
//
// `gjsify storybook` discovers `*.story.ts`, generates an entry that imports
// `@gjsify/storybook`, and builds + launches it. `--runtime node` flips the
// build to `--app node` (gi:// → `@gjsify/node-gi`) and the launcher to `node`,
// so the SAME GJS/Adwaita storybook source renders on Node.js.
//
// This suite LOCKS IN the flag + routing without needing a display or the
// node-gyp-built `@gjsify/node-gi` addon: it builds the storybook for the node
// target (`--build-only`, which returns before the launch/node-gi check) and
// asserts the produced bundle is a real node-gi bundle — `gi://` rewritten to
// `requireGi`, `@gjsify/node-gi` kept external, no raw `gi://` left — and that
// it differs from the default `--runtime gjs` bundle (which has no node-gi
// routing). `@gjsify/node-gi` is EXTERNAL for `--app node`, so the build needs
// no C++ toolchain — the suite runs in CI on a plain Node host.
//
// The real render assertion (window appears, windows>=1, clean exit) needs a
// display + the node-gi addon; it is proven locally + documented in this
// suite's README and the storybook-on-node memory. The render-probe used there
// is also generated here when a display + an installed @gjsify/node-gi are
// present (so a future Xvfb job that builds the addon can flip it on), and
// SELF-SKIPS otherwise.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

// A single minimal story — enough to drive the storybook discovery + build.
const LABEL_STORY = `
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

export class LabelStory extends StoryWidget {
    private _label: Gtk.Label | null = null;

    static {
        GObject.registerClass({ GTypeName: 'E2ELabelStory' }, LabelStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(LabelStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Basics/Label',
            component: Gtk.Label.$gtype,
            args: { text: 'Hello from Node' },
            controls: [{ name: 'text', type: 'text' }],
        };
    }

    initialize(): void {
        this._label = new Gtk.Label({ label: this.args['text'] as string });
        this.addContent(this._label);
    }

    updateArgs(): void {
        if (this._label) this._label.label = this.args['text'] as string;
    }
}

GObject.type_ensure(LabelStory.$gtype);

export const LabelStories: StoryModule = { stories: [LabelStory] };
`;

describe('gjsify storybook --runtime node E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let gjsifyBin;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-storybook-on-node-');
        tmpDir = env.tmpDir;

        projectDir = join(tmpDir, 'storybook-on-node-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-storybook-on-node',
                version: '0.1.0',
                type: 'module',
                private: true,
                gjsify: {
                    storybook: {
                        applicationId: 'org.gjsify.e2e.StorybookOnNode',
                        title: 'Storybook on Node E2E',
                        stories: 'src',
                        globals: 'auto',
                    },
                },
                devDependencies: {
                    '@gjsify/cli': '^0.1.0',
                    '@gjsify/storybook': '^0.1.0',
                    '@girs/gjs': '4.0.4',
                    '@girs/glib-2.0': '2.88.0-4.0.4',
                    '@girs/gobject-2.0': '2.88.0-4.0.4',
                    '@girs/gio-2.0': '2.88.0-4.0.4',
                    '@girs/gdk-4.0': '4.0.0-4.0.4',
                    '@girs/gtk-4.0': '4.23.0-4.0.4',
                    '@girs/adw-1': '1.10.0-4.0.4',
                },
            },
            env.tarballsDir,
            env.tarballMap,
        );

        writeFileSync(join(projectDir, 'src', 'label.story.ts'), LABEL_STORY);
        gjsifyBin = join(projectDir, 'node_modules', '.bin', 'gjsify');
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    function buildStorybook(runtime, outfile) {
        execFileSync(gjsifyBin, ['storybook', '--runtime', runtime, '--build-only', '--out', outfile], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 5 * 60 * 1000,
            encoding: 'utf-8',
        });
        const outPath = join(projectDir, outfile);
        assert.ok(existsSync(outPath), `${outfile} was not produced for --runtime ${runtime}`);
        return readFileSync(outPath, 'utf-8');
    }

    it('--runtime node builds a node-gi bundle (gi:// → requireGi, node-gi external)', () => {
        const node = buildStorybook('node', 'dist/storybook.node.mjs');

        // gi:// is rewritten to the @gjsify/node-gi L1 runtime.
        assert.ok(node.includes('requireGi'), 'node bundle is missing the requireGi rewrite');
        assert.ok(node.includes('@gjsify/node-gi'), 'node bundle does not reference @gjsify/node-gi');
        // No raw `gi://` specifier survives (all rewritten).
        assert.ok(!node.includes('gi://'), 'node bundle still contains a raw gi:// specifier');

        // Syntactically valid Node ESM.
        const outPath = join(projectDir, 'dist', 'storybook.node.mjs');
        execFileSync(process.execPath, ['--check', outPath], { stdio: 'pipe' });
    });

    it('--runtime gjs (default target) keeps gi:// external — no node-gi routing', () => {
        const gjs = buildStorybook('gjs', 'dist/storybook.gjs.mjs');
        assert.ok(!gjs.includes('requireGi'), 'gjs bundle must NOT carry the node-gi requireGi rewrite');
        // The gjs target externalises gi:// (resolved by GJS natively at runtime).
        assert.ok(gjs.includes('gi://'), 'gjs bundle should keep gi:// specifiers external');
    });
});
