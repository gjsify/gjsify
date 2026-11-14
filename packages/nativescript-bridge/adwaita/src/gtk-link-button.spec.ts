// `Gtk.LinkButton` — a `Gtk.Button` that follows a URI — against the platform double.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';

/** A tap, as NativeScript delivers one to a `GridLayout` the button's constructor listens on. */
const tap = (button: object): void => (button as Gtk.Button).notify({ eventName: 'tap', object: button as never });

/** A link button that records what it was asked to open instead of opening it. */
class RecordingLinkButton extends Gtk.LinkButton {
    readonly launched: string[] = [];
    protected override launch(uri: string): void {
        this.launched.push(uri);
    }
}

export const GtkLinkButtonNsTest = async () => {
    await describe('Gtk.LinkButton', async () => {
        await it('is a Gtk.Button that wears flat and link, with an empty uri and not visited', () => {
            const button = new Gtk.LinkButton({ label: 'GNOME' });
            expect(button instanceof Gtk.Button).toBe(true);
            expect(button.label).toBe('GNOME');
            expect(button.uri).toBe('');
            expect(button.visited).toBe(false);
            expect(button.get_css_classes()).toStrictEqual(['flat', 'link']);
            expect(button.className).toBe('adw-button flat link');
        });

        await it('wears `visited` only while visited, and styleClasses does not list it', () => {
            const button = new Gtk.LinkButton({ visited: true });
            expect(button.className).toBe('adw-button flat link visited');
            expect(button.styleClasses).toStrictEqual(['flat', 'link']);
            button.visited = false;
            expect(button.className).toBe('adw-button flat link');
        });

        await it('set_uri notifies uri, then clears visited, notifying that only if it was set', () => {
            const button = new Gtk.LinkButton({ uri: 'https://a.example', visited: true });
            const seen: string[] = [];
            button.connect('notify::uri', () => seen.push('uri'));
            button.connect('notify::visited', () => seen.push('visited'));
            button.set_uri('https://b.example');
            button.set_uri('https://b.example');
            expect(seen).toStrictEqual(['uri', 'visited', 'uri']);
            expect(button.visited).toBe(false);
        });

        await it('reads the string an XML attribute hands the setter', () => {
            const button = build({
                tag: 'GtkLinkButton',
                props: { uri: 'https://gnome.org', label: 'GNOME', visited: 'true' },
            }) as unknown as Gtk.LinkButton;
            expect(button.get_uri()).toBe('https://gnome.org');
            expect(button.get_visited()).toBe(true);
        });

        await it('a tap launches the uri, marks the link visited and runs after activate-link', () => {
            const button = new RecordingLinkButton({ uri: 'https://gnome.org' });
            const seen: string[] = [];
            button.connect('activate-link', (self: Gtk.LinkButton) => {
                seen.push(`activate-link ${self.uri}`);
                return false;
            });
            button.connect('clicked', () => seen.push(`clicked visited=${button.visited}`));
            tap(button);
            expect(button.launched).toStrictEqual(['https://gnome.org']);
            expect(button.visited).toBe(true);
            expect(seen).toStrictEqual(['activate-link https://gnome.org', 'clicked visited=true']);
        });

        await it('a handler that returns true stops the launch and leaves the link unvisited', () => {
            const button = new RecordingLinkButton({ uri: 'https://gnome.org' });
            button.connect('activate-link', () => true);
            tap(button);
            expect(button.launched).toStrictEqual([]);
            expect(button.visited).toBe(false);
        });

        await it('an empty uri launches nothing but still marks the link visited, as GTK does', () => {
            const button = new RecordingLinkButton();
            tap(button);
            expect(button.launched).toStrictEqual([]);
            expect(button.visited).toBe(true);
        });
    });
};
