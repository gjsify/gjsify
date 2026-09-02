// StoryWidget — GTK-only checks that the core delegation wrapper keeps the
// GObject `notify::args` signal firing (the window's controls-refresh depends on
// it) and that the core-owned state surface (meta/story/args/setArg/
// onArgsChanged/addContent) reaches through the wrapper.
//
// GJS-only (extends Adw.Bin → needs the Gtk/Adw typelibs), so direct @gjsify
// imports are fine here (testing rule 2/2b).

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ControlType, type StoryMeta } from '@gjsify/stories';
import { describe, expect, it, on } from '@gjsify/unit';
import { StoryWidget } from './story-widget.js';

const META: StoryMeta = {
    title: 'Test/Widget',
    description: 'A test story',
    controls: [
        { name: 'label', type: ControlType.TEXT, label: 'Label', defaultValue: 'hi' },
        { name: 'enabled', type: ControlType.BOOLEAN, label: 'Enabled', defaultValue: true },
    ],
};

/** Every `Gtk.Label` text under `root` — what the chrome actually renders. */
function labelTexts(root: Gtk.Widget): string[] {
    const found: string[] = [];
    let child = root.get_first_child();
    while (child) {
        if (child instanceof Gtk.Label) found.push(child.get_text());
        found.push(...labelTexts(child));
        child = child.get_next_sibling();
    }
    return found;
}

// A real story subclass — a GObject class must be registered once at module
// scope (registering twice with the same GTypeName throws), so the subclass
// lives here rather than inside an `it()` body.
let lastUpdatedLabel: string | undefined;
class SubStory extends StoryWidget {
    static {
        GObject.registerClass({ GTypeName: 'StorybookSpecSubStory' }, SubStory);
    }
    constructor() {
        super(StoryWidget.fromMeta(META, 'Default'));
    }
    override updateArgs(): void {
        lastUpdatedLabel = this.args.label as string;
    }
}
GObject.type_ensure(SubStory.$gtype);

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();

        await describe('StoryWidget — GObject notify::args bridge', async () => {
            await it('fires notify::args when args is set', async () => {
                const w = new StoryWidget(StoryWidget.fromMeta(META, 'Default'));
                let fired = 0;
                w.connect('notify::args', () => {
                    fired++;
                });
                w.args = { ...w.args, label: 'changed' };
                expect(fired).toBe(1);
                expect(w.args.label).toBe('changed');
            });

            await it('fires notify::args via setArg', async () => {
                const w = new StoryWidget(StoryWidget.fromMeta(META, 'Default'));
                let fired = 0;
                w.connect('notify::args', () => {
                    fired++;
                });
                w.setArg('enabled', false);
                expect(fired).toBe(1);
                expect(w.args.enabled).toBe(false);
            });

            await it('does not fire when set to the same args object', async () => {
                const w = new StoryWidget(StoryWidget.fromMeta(META, 'Default'));
                const sameRef = w.args;
                let fired = 0;
                w.connect('notify::args', () => {
                    fired++;
                });
                w.args = sameRef; // identical reference — the guard short-circuits
                expect(fired).toBe(0);
            });

            await it('also notifies onArgsChanged listeners', async () => {
                const w = new StoryWidget(StoryWidget.fromMeta(META, 'Default'));
                const seen: string[] = [];
                const unsub = w.onArgsChanged((args) => {
                    seen.push(args.label as string);
                });
                w.setArg('label', 'via-listener');
                expect(seen).toContain('via-listener');
                unsub();
                w.setArg('label', 'after-unsub');
                expect(seen).not.toContain('after-unsub');
            });
        });

        await describe('StoryWidget — core state surface through the wrapper', async () => {
            await it('exposes meta/story and seeds args from controls', async () => {
                const w = new StoryWidget(StoryWidget.fromMeta(META, 'Default'));
                expect(w.meta.title).toBe('Test/Widget');
                expect(w.story).toBe('Default');
                expect(w.args.label).toBe('hi');
                expect(w.args.enabled).toBe(true);
            });

            await it('runs updateArgs on the subclass when args change', async () => {
                const w = new SubStory();
                lastUpdatedLabel = undefined;
                w.setArg('label', 'updated');
                expect(lastUpdatedLabel).toBe('updated');
            });

            await it('renders a title and description containing markup characters', async () => {
                // BOTH AdwPreferencesGroup labels are `use-markup="True"`
                // (adw-preferences-group.ui:20-23, :33-35) while a StoryMeta's
                // strings are renderer-agnostic PLAIN TEXT. An unescaped `&` made
                // Pango reject the whole string, so the chrome rendered EMPTY with
                // only a Gtk-WARNING on stderr — found by the first meta to
                // describe an accelerator grammar: "pressed together (&)".
                const description = 'Levels: a range (...), in sequence (+) & together (&). Also <angles>.';
                const w = new StoryWidget(
                    StoryWidget.fromMeta({ ...META, title: 'A & B <C>', description }, 'Default'),
                );

                const texts = labelTexts(w);
                // `get_text()` returns the PARSED text, so the markup characters
                // come back as written rather than as entities.
                expect(texts).toContain(description);
                expect(texts.some((text) => text.includes('A & B <C>'))).toBe(true);
            });

            await it('addContent installs the child into the default stage', async () => {
                const w = new StoryWidget(StoryWidget.fromMeta(META, 'Default'));
                const child = new Gtk.Label({ label: 'preview' });
                w.addContent(child);
                // The default chrome roots an Adw.PreferencesPage in the Bin.
                expect(w.get_child() instanceof Adw.PreferencesPage).toBeTruthy();
            });
        });
    });
};
