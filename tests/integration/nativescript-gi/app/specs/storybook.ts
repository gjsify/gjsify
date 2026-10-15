// THE STORYBOOK LEG of the dual emulator run (ADR 0110 § 3) — a story authored the way a real
// `*.ns.ts` file is authored, driven through the registry and the controls panel, over whichever
// engine backs the subset.
//
// WHY A STORYBOOK SPEC AT ALL. `@gjsify/storybook-nativescript`'s view layer (`story-view.ts`,
// `controls.ts`, `app.ts`, `devtools.ts`) imports `@nativescript/core`, so it is tested NOWHERE
// off-device: the core logic below it has unit tests (`storybook-core`'s `controls.spec.ts`,
// `registry.spec.ts`, `story-view-base.spec.ts`), the NativeScript half has none. The device is
// the only place it runs, and this is the only suite that runs it.
//
// WHY IT RUNS ON BOTH ENGINES. The storybook's own classes are plain TypeScript — the engine does
// not back `StoryView`. What the engine backs is the thing a story PUTS ON THE STAGE: a composite
// widget written with `GObject.registerClass`, exactly like the GTK twin's `StoryWidget`
// subclasses. So the chain this suite asserts — a control row's event → `setArg` → `updateArgs` →
// a declared GObject property → `notify::` → the args listener the panel re-syncs from — crosses
// the engine in its middle, and it has to behave the same in both legs or a storybook built on
// the Android default stops matching a storybook built on the subset.
//
// NOT COVERED HERE: `StorybookNativeApp`/`runStorybook` (they mount a `Frame` and navigate a
// `Page`, which this headless suite has no main page for) and the devtools surface. The two
// showcase APKs still exercise those by hand only — `README.md` says so.
import * as GObject from '@gjsify/adwaita-nativescript/gobject';
import { Adw } from '@gjsify/adwaita-nativescript';
import { bindProperties, type GObjectInstance } from '@gjsify/adwaita-core';
import {
    ControlType,
    createControlRow,
    StoryRegistry,
    StoryView,
    type StoryArgs,
    type StoryControl,
    type StoryMeta,
} from '@gjsify/storybook-nativescript';
import type { View } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';

/** The widget a story puts on the stage — a registered composite over a real port widget. */
class DualEngineBadge extends Adw.Bin {
    declare caption: string;
    declare loud: boolean;
}

GObject.registerClass(
    {
        GTypeName: 'GjsifyDualEngineBadge',
        Properties: {
            caption: GObject.ParamSpec.string('caption', '', '', GObject.ParamFlags.READWRITE, ''),
            loud: GObject.ParamSpec.boolean('loud', '', '', GObject.ParamFlags.READWRITE, false),
        },
    },
    DualEngineBadge,
);

const LEVEL_OPTIONS = [
    { label: 'One', value: 'one' },
    { label: 'Two', value: 'two' },
];

const BADGE_META: StoryMeta = {
    title: 'Dual/Badge',
    description: 'the ADR 0110 § 3 story, authored once and run on both engines',
    controls: [
        { name: 'caption', label: 'Caption', type: ControlType.TEXT, defaultValue: 'hello' },
        { name: 'loud', label: 'Loud', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'level', label: 'Level', type: ControlType.SELECT, options: LEVEL_OPTIONS, defaultValue: 'two' },
    ],
};

/** A story exactly as a `*.ns.ts` file writes one: build in `initialize`, react in `updateArgs`. */
class BadgeStory extends StoryView {
    badge: DualEngineBadge | null = null;
    /** Every `notify::caption` the engine delivered — the args path's receipt. */
    readonly notified: string[] = [];

    constructor() {
        super(BADGE_META, 'Default');
    }

    override initialize(): void {
        const badge = new DualEngineBadge();
        (badge as unknown as GObjectInstance).connect('notify::caption', () => {
            this.notified.push(badge.caption);
        });
        this.badge = badge;
        this.addContent(badge as unknown as View);
        this.updateArgs(this.args);
    }

    override updateArgs(args: StoryArgs): void {
        const badge = this.badge;
        if (badge === null) return;
        badge.caption = typeof args.caption === 'string' ? args.caption : '';
        badge.loud = Boolean(args.loud);
    }
}

/** Read a built row back as the concrete port widget it is. */
function asEntryRow(view: View): InstanceType<typeof Adw.EntryRow> {
    return view as unknown as InstanceType<typeof Adw.EntryRow>;
}

/**
 * @param engine the engine this leg runs on — reported, never branched on, for the same reason
 *   `specs/views.ts` does not branch on it.
 */
export const storybookSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`the NativeScript storybook on '${engine}' (ADR 0110 § 3)`, async () => {
        await it('a story builds real NativeScript chrome and seeds its args from the controls', () => {
            const story = new BadgeStory();
            // `root` is what a `Page` mounts: lose it and the storybook has nothing to show, which
            // is the one failure the core's own `story-view-base.spec.ts` cannot see (it builds a
            // fake chrome).
            expect(typeof (story.root as unknown as { eachChildView?: unknown }).eachChildView).toBe('function');
            expect(story.args).toEqual({ caption: 'hello', loud: false, level: 'two' });
            expect(story.meta.title).toBe('Dual/Badge');
        });

        await it('the registry instantiates the story, runs its decorators and then initialize', () => {
            const order: string[] = [];
            const registry = new StoryRegistry<BadgeStory>();
            registry.registerStories([
                {
                    stories: [BadgeStory],
                    decorators: [
                        (build, instance) => {
                            order.push(`outer:${instance.badge === null ? 'unbuilt' : 'built'}`);
                            build();
                            order.push('outer-after');
                        },
                        (build) => {
                            order.push('inner');
                            build();
                        },
                    ],
                },
            ]);
            const modules = registry.createStoryInstances();
            expect(order.join(',')).toBe('outer:unbuilt,inner,outer-after');
            const instance = modules[0].instances?.[0];
            expect(instance instanceof BadgeStory).toBe(true);
            // `initialize` ran, so the stage carries the registered widget.
            expect((instance as BadgeStory).badge instanceof DualEngineBadge).toBe(true);
        });

        await it('setArg reaches the stage widget through the engine, and listeners see it once', () => {
            const story = new BadgeStory();
            story.initialize();
            const seen: StoryArgs[] = [];
            const stop = story.onArgsChanged((args) => seen.push(args));

            story.setArg('caption', 'typed');
            story.setArg('loud', true);
            stop();
            story.setArg('caption', 'after-unsubscribe');

            const badge = story.badge as DualEngineBadge;
            expect(badge.caption).toBe('after-unsubscribe');
            expect(badge.loud).toBe(true);
            expect(seen.length).toBe(2);
            // The GObject side of the same path. `initialize` pushed the seeded 'hello' first;
            // the `loud` write re-set `caption` to the value it already had and added nothing,
            // which is the engine's own change gate doing its job inside `updateArgs`.
            expect(story.notified.join(',')).toBe('hello,typed,after-unsubscribe');
        });

        await it('a text control row writes the edit back into the story args', () => {
            const story = new BadgeStory();
            story.initialize();
            const control = BADGE_META.controls?.[0] as StoryControl;
            const row = createControlRow(story, control);
            expect(row === null).toBe(false);

            const entry = asEntryRow((row as NonNullable<typeof row>).view);
            // The row was seeded from the args before any edit.
            expect(entry.text).toBe('hello');
            // A write to `text` is what a user's keystroke lands on: the row emits `notify::text`,
            // which is the event `bindControl` subscribed to.
            entry.text = 'edited';
            expect(story.args.caption).toBe('edited');
            expect((story.badge as DualEngineBadge).caption).toBe('edited');
        });

        await it('refresh pushes a programmatic args change back into the row', () => {
            const story = new BadgeStory();
            story.initialize();
            const row = createControlRow(story, BADGE_META.controls?.[0] as StoryControl);
            const entry = asEntryRow((row as NonNullable<typeof row>).view);

            story.setArg('caption', 'from-code');
            (row as NonNullable<typeof row>).refresh(story.args);
            expect(entry.text).toBe('from-code');
            // The refresh DOES come back round — writing the row fires its `notify::text`, which
            // calls `setArg` again — and that is only harmless because the second pass reaches a
            // property that already holds the value and the engine emits nothing. Exactly one
            // notification per programmatic change is what keeps the panel from re-syncing
            // forever, and it is the engine, not the storybook, that decides it.
            expect(story.notified.join(',')).toBe('hello,from-code');
        });

        await it('a boolean row round-trips through the args', () => {
            const story = new BadgeStory();
            story.initialize();
            const row = createControlRow(story, BADGE_META.controls?.[1] as StoryControl);
            const toggle = (row as NonNullable<typeof row>).view as unknown as InstanceType<typeof Adw.SwitchRow>;
            expect(toggle.active).toBe(false);
            toggle.active = true;
            expect(story.args.loud).toBe(true);
            expect((story.badge as DualEngineBadge).loud).toBe(true);

            story.setArg('loud', false);
            (row as NonNullable<typeof row>).refresh(story.args);
            expect(toggle.active).toBe(false);
        });

        await it('a select row maps the arg value onto an option index', () => {
            const story = new BadgeStory();
            story.initialize();
            const row = createControlRow(story, BADGE_META.controls?.[2] as StoryControl);
            const combo = (row as NonNullable<typeof row>).view as unknown as InstanceType<typeof Adw.ComboRow>;
            // Seeded from `defaultValue: 'two'`, which is index 1 — the index↔value map is the one
            // piece of SELECT the renderer does not own.
            expect(combo.selected).toBe(1);

            story.setArg('level', 'one');
            (row as NonNullable<typeof row>).refresh(story.args);
            expect(combo.selected).toBe(0);
            // The other direction (a user pick) needs the native chooser: `Adw.ComboRow` only
            // emits `notify::selected` for an INTERACTIVE change, so a programmatic `selected`
            // write cannot stand in for it. That half stays a manual check in the showcase app.
            info(`select row seeded and refreshed; selectedValue = ${combo.selectedValue}`);
        });

        await it('a select control with no options renders no row at all', () => {
            const story = new BadgeStory();
            const row = createControlRow(story, {
                name: 'empty',
                label: 'Empty',
                type: ControlType.SELECT,
                options: [],
            });
            expect(row === null).toBe(true);
        });

        await it('two stage widgets bind to each other on the live tree', () => {
            // The storybook's own "linked controls" shape: one story's widget driving another's.
            // It is `bindProperties` over two registered classes, which is the engine doing the
            // work, with both widgets actually parented in a story's stage.
            const left = new BadgeStory();
            const right = new BadgeStory();
            left.initialize();
            right.initialize();
            bindProperties(
                left.badge as unknown as GObjectInstance,
                'caption',
                right.badge as unknown as GObjectInstance,
                'caption',
            );
            left.setArg('caption', 'linked');
            expect((right.badge as DualEngineBadge).caption).toBe('linked');
        });
    });
};
