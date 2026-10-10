// `Gtk.Widget` members a registered class gets from the port: direction, tree links and
// `insert_action_group`. GTK's own answers (gtkwidget.c) are the oracle.

import { describe, expect, it } from '@gjsify/unit';

import * as GObject from './namespace/gobject.js';
import * as Gio from './namespace/gio.js';
import { writeProp } from './shared-tree-builder.js';
import { registerTemplateClass } from './template-classes.js';

interface WidgetLike extends HTMLElement {
    set_direction(direction: number): void;
    get_direction(): number;
    get_first_child(): Element | null;
    get_last_child(): Element | null;
    get_next_sibling(): Element | null;
    get_prev_sibling(): Element | null;
    get_parent(): Element | null;
    insert_action_group(name: string, group: unknown): void;
}

const make = (name: string): WidgetLike =>
    new (GObject.registerClass({ GTypeName: name }, class extends HTMLElement {}) as unknown as new () => WidgetLike)();

export const WidgetMembersTest = async () => {
    await describe('Gtk.Widget members on a registered class', async () => {
        await it('is LTR until set_direction, and reads back what it was given', () => {
            const widget = make('WidgetMembersDirection');
            expect(widget.get_direction()).toBe(1);
            widget.set_direction(2);
            expect(widget.get_direction()).toBe(2);
            document.body.append(widget);
            expect(widget.dir).toBe('rtl');
            widget.set_direction(0);
            expect(widget.hasAttribute('dir')).toBe(false);
            widget.remove();
        });

        await it('is set in the constructor of an element that createElement builds, which may take no attribute', () => {
            class Pinned extends HTMLElement {
                constructor() {
                    super();
                    (this as unknown as WidgetLike).set_direction(1);
                }
            }
            GObject.registerClass({ GTypeName: 'WidgetMembersCtor' }, Pinned);
            const widget = document.createElement('gjsify-widget-members-ctor') as WidgetLike;
            document.body.append(widget);
            expect(widget.dir).toBe('ltr');
            widget.remove();
        });

        await it('rejects a direction that is not a Gtk.TextDirection', () => {
            const widget = make('WidgetMembersBadDirection');
            expect(() => widget.set_direction(7)).toThrow();
        });

        await it('walks the element tree with the GTK link names', () => {
            const parent = make('WidgetMembersParent');
            const a = document.createElement('div');
            const b = document.createElement('div');
            parent.append(a, b);
            expect(parent.get_first_child()).toBe(a);
            expect(parent.get_last_child()).toBe(b);
            expect(a.nextElementSibling).toBe(b);
            expect(parent.get_next_sibling()).toBe(null);
            expect(parent.get_prev_sibling()).toBe(null);
            expect(parent.get_parent()).toBe(null);
        });

        await it('takes an action group and drops it again with null', () => {
            const widget = make('WidgetMembersActions');
            const group = new Gio.SimpleActionGroup();
            widget.insert_action_group('source-view', group);
            widget.insert_action_group('source-view', null);
        });
    });

    await describe('the stylesheet of a registered class', async () => {
        await it('gets the rules its base tag has, for every selector that names the base', () => {
            class StyleBase extends HTMLElement {}
            customElements.define('widget-style-base', StyleBase);
            const sheet = document.createElement('style');
            sheet.textContent =
                'widget-style-base { display: block; padding-left: 7px; }' +
                'widget-style-base > :only-child { block-size: 100%; }' +
                'widget-style-other, widget-style-base { margin-left: 3px; }' +
                '@media (min-width: 1px) { widget-style-base { margin-right: 5px; } }';
            document.head.append(sheet);
            GObject.registerClass({ GTypeName: 'WidgetStyleSub' }, class extends StyleBase {});
            const widget = document.createElement('gjsify-widget-style-sub');
            document.body.append(widget);
            const style = getComputedStyle(widget);
            expect(style.display).toBe('block');
            expect(style.paddingLeft).toBe('7px');
            expect(style.marginLeft).toBe('3px');
            expect(style.marginRight).toBe('5px');
            widget.remove();
            sheet.remove();
        });

        await it('takes an authored template property as a GObject property, not an attribute', () => {
            class Props extends HTMLElement {
                seen: unknown[] = [];
                set lineNumbers(value: boolean) {
                    this.seen.push(value);
                }
                set lineNumberStart(value: number) {
                    this.seen.push(value);
                }
            }
            GObject.registerClass({ GTypeName: 'WidgetMembersProps' }, Props);
            registerTemplateClass('WidgetMembersProps', 'gjsify-widget-members-props');
            const widget = document.createElement('gjsify-widget-members-props') as Props;
            writeProp(widget, 'line-numbers', true);
            writeProp(widget, 'line-number-start', 1536);
            expect(widget.seen).toStrictEqual([true, 1536]);
            expect(widget.hasAttribute('line-numbers')).toBe(false);
        });

        await it('reaches the DOM when a class writes icon_name or tooltip_text on a button', () => {
            const button = document.createElement('gtk-button') as HTMLElement & { icon_name: string; tooltip_text: string };
            document.body.append(button);
            button.icon_name = 'edit-copy-symbolic';
            button.tooltip_text = 'Copy';
            expect(button.getAttribute('icon-name')).toBe('edit-copy-symbolic');
            expect(button.querySelector('button')?.title).toBe('Copy');
            expect(button.querySelector('gtk-image') !== null).toBe(true);
            button.remove();
        });
    });
};
