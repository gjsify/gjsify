// `Gtk.Widget` members a registered class gets from the port: direction, tree links and
// `insert_action_group`. GTK's own answers (gtkwidget.c) are the oracle.

import { describe, expect, it } from '@gjsify/unit';

import * as Graphene from './namespace/graphene.js';
import * as Gtk from './namespace/gtk.js';
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
    get_width(): number;
    get_height(): number;
    compute_point(target: Element, point: Graphene.Point): [boolean, Graphene.Point];
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

        await it('walks the element tree of a built-in widget with the GTK link names', () => {
            const box = new Gtk.Box() as unknown as WidgetLike;
            const a = new Gtk.Label() as unknown as WidgetLike;
            const b = new Gtk.Label() as unknown as WidgetLike;
            expect(box.get_first_child()).toBe(null);
            box.append(a, b);
            expect(box.get_first_child()).toBe(a);
            expect(box.get_last_child()).toBe(b);
            expect(a.get_next_sibling()).toBe(b);
            expect(b.get_prev_sibling()).toBe(a);
            expect(b.get_next_sibling()).toBe(null);
            expect(a.get_parent()).toBe(box);
            expect(box.get_parent()).toBe(null);
        });

        await it('adds, tests and removes a CSS class with the GTK names', () => {
            const widget = make('WidgetMembersCss') as unknown as {
                add_css_class(c: string): void;
                remove_css_class(c: string): void;
                has_css_class(c: string): boolean;
            };
            widget.add_css_class('dim-label');
            expect(widget.has_css_class('dim-label')).toBe(true);
            widget.remove_css_class('dim-label');
            expect(widget.has_css_class('dim-label')).toBe(false);
        });

        await it('computes a point from the bounding boxes, on a registered class and a built-in element', () => {
            const placed = <T extends Element>(element: T, left: number, top: number): T => {
                element.getBoundingClientRect = () => ({ left, top }) as DOMRect;
                return element;
            };
            const scrolled = placed(new Gtk.ScrolledWindow(), 10, 100);
            const registered = placed(make('WidgetMembersPoint'), 14, 130);
            const builtIn = placed(new Gtk.Label(), 11, 105);
            scrolled.append(registered, builtIn);
            document.body.append(scrolled);

            const [ok, point] = registered.compute_point(scrolled, Graphene.Point.zero());
            expect(ok).toBe(true);
            expect(point.x).toBe(4);
            expect(point.y).toBe(30);
            const [okBuiltIn, shifted] = builtIn.compute_point(scrolled, new Graphene.Point({ x: 2, y: 3 }));
            expect(okBuiltIn).toBe(true);
            expect(shifted.x).toBe(3);
            expect(shifted.y).toBe(8);
            scrolled.remove();
        });

        await it('measures a real layout: size, offset inside a scrolled window, and the offset after scrolling', async () => {
            const host = document.createElement('div');
            host.style.width = '200px';
            host.style.height = '100px';
            document.body.append(host);
            const scrolled = new Gtk.ScrolledWindow();
            scrolled.style.height = '100px';
            host.append(scrolled);
            const labels: Gtk.Label[] = [];
            for (let i = 0; i < 10; i++) {
                const label = new Gtk.Label();
                // An empty label has no content for the viewport to overflow, so Firefox does not scroll it.
                label.setAttribute('label', `Row ${i}`);
                label.style.height = '40px';
                scrolled.append(label);
                labels.push(label);
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            expect(scrolled.get_height()).toBe(100);
            expect(scrolled.get_width()).toBe(200);
            expect(labels[0].get_height()).toBe(40);

            const label = labels[5];
            const [ok, before] = label.compute_point(scrolled, Graphene.Point.zero());
            expect(ok).toBe(true);
            scrolled.viewport.scrollAxis('vertical', 80);
            const [okAfter, after] = label.compute_point(scrolled, Graphene.Point.zero());
            expect(okAfter).toBe(true);
            expect(before.y - after.y).toBe(80);
            host.remove();
        });

        await it('reports 0 for width and height while a widget is not rendered', () => {
            const loose = new Gtk.Label();
            expect(loose.get_width()).toBe(0);
            expect(loose.get_height()).toBe(0);
            const registered = make('WidgetMembersSize');
            expect(registered.get_width()).toBe(0);
            expect(registered.get_height()).toBe(0);
        });

        await it('computes no point between widgets that share no tree', () => {
            const attached = make('WidgetMembersPointAttached');
            const loose = make('WidgetMembersPointLoose');
            document.body.append(attached);
            const [ok, point] = loose.compute_point(attached, new Graphene.Point({ x: 5, y: 5 }));
            expect(ok).toBe(false);
            expect(point.x).toBe(0);
            expect(point.y).toBe(0);
            attached.remove();
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
            const button = document.createElement('gtk-button') as HTMLElement & {
                icon_name: string;
                tooltip_text: string;
            };
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
