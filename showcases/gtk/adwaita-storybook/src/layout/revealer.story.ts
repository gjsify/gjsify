// Gtk.Revealer — one of the fourteen transitions, driven by the shared controls.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { revealerMeta } from './revealer.meta.js';

/** The story arg is the transition's GIR nick, which is also what `Gtk.Revealer` takes. */
const TRANSITIONS: Record<string, Gtk.RevealerTransitionType> = {
    none: Gtk.RevealerTransitionType.NONE,
    crossfade: Gtk.RevealerTransitionType.CROSSFADE,
    'slide-right': Gtk.RevealerTransitionType.SLIDE_RIGHT,
    'slide-left': Gtk.RevealerTransitionType.SLIDE_LEFT,
    'slide-up': Gtk.RevealerTransitionType.SLIDE_UP,
    'slide-down': Gtk.RevealerTransitionType.SLIDE_DOWN,
    'swing-right': Gtk.RevealerTransitionType.SWING_RIGHT,
    'swing-left': Gtk.RevealerTransitionType.SWING_LEFT,
    'swing-up': Gtk.RevealerTransitionType.SWING_UP,
    'swing-down': Gtk.RevealerTransitionType.SWING_DOWN,
    'fade-slide-right': Gtk.RevealerTransitionType.FADE_SLIDE_RIGHT,
    'fade-slide-left': Gtk.RevealerTransitionType.FADE_SLIDE_LEFT,
    'fade-slide-up': Gtk.RevealerTransitionType.FADE_SLIDE_UP,
    'fade-slide-down': Gtk.RevealerTransitionType.FADE_SLIDE_DOWN,
};

/** Story: a Gtk.Revealer over a box, so every transition has room to move. */
export class RevealerStory extends StoryWidget {
    private _revealer: Gtk.Revealer | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookRevealer' }, RevealerStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(RevealerStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...revealerMeta, component: Gtk.Revealer.$gtype };
    }

    initialize(): void {
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        content.append(new Gtk.Label({ label: 'The revealed child' }));
        const hint = new Gtk.Label({ label: 'Drag the controls to change the transition' });
        hint.add_css_class('dim-label');
        content.append(hint);

        this._revealer = new Gtk.Revealer();
        this._revealer.set_child(content);
        this._apply();
        this.addContent(this._revealer);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._revealer) return;
        // `effective_transition` is not reachable from outside, so the story sets the nick the
        // property takes and lets GTK mirror it for an RTL direction.
        this._revealer.transition_type = TRANSITIONS[String(this.args.transitionType)];
        this._revealer.transition_duration = Number(this.args.transitionDuration);
        this._revealer.reveal_child = this.args.revealChild as boolean;
    }
}

GObject.type_ensure(RevealerStory.$gtype);

export const RevealerStories: StoryModule = { stories: [RevealerStory] };
