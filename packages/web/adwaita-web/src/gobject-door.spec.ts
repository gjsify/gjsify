// ADR 0096: the web door of the GObject subset, against the shared vectors and end to end.
import { parseBlueprint, projectToSharedNode } from '@gjsify/blueprint';
import { GOBJECT_VECTORS, driveGObjectVectors, type GObjectSubject } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { Adw, GObject } from './index.js';
import { tagForTypeName } from './gobject-door.js';
import { listenElement } from './gobject-elements.js';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { bindProperties } from '@gjsify/adwaita-core';

function tree(body: string): SharedTreeNode {
    const { node, lost } = projectToSharedNode(
        parseBlueprint(`using Gtk 4.0;\nusing Adw 1;\n\n${body}\n`, 'gobject-door.spec.blp'),
    );
    if (lost.length > 0) throw new Error(`the projection dropped ${lost.map((loss) => loss.kind).join(', ')}`);
    return node as SharedTreeNode;
}

const subject: GObjectSubject = {
    name: 'adwaita-web',
    isOracle: false,
    GObject: GObject as unknown as GObjectSubject['GObject'],
    Widget: Adw.Bin as unknown as GObjectSubject['Widget'],
    template: (source) => source.tree,
    bind: (source, sourceProperty, target, targetProperty, flags) => {
        bindProperties(source, sourceProperty, target, targetProperty, flags);
    },
};

const Template = tree(`template $GoWebHexdump : Adw.Bin {
    child: Gtk.Box {
        Gtk.Switch sw { active: bind template.enabled bidirectional; }
        Gtk.Button btn { clicked => $onClicked(); }
    };
}`);

class GoWebHexdump extends Adw.Bin {
    declare _sw: HTMLElement & { active: boolean };
    declare _btn: HTMLElement;
    declare enabled: boolean;
    clicks = 0;
    seenInConstructor = false;
    constructor(params?: Record<string, unknown>) {
        // @ts-expect-error the element's own constructor takes none; the registered class's takes the params
        super(params);
        this.seenInConstructor = this._btn !== undefined;
        (this._btn as unknown as { connect(s: string, h: () => void): number }).connect('clicked', () => {
            this.clicks += 10;
        });
    }
    onClicked(): void {
        this.clicks++;
    }
}
GObject.registerClass(
    {
        GTypeName: 'GoWebHexdump',
        Template,
        InternalChildren: ['sw', 'btn'],
        Properties: { enabled: GObject.ParamSpec.boolean('enabled', '', '', GObject.ParamFlags.READWRITE, false) },
    },
    GoWebHexdump as never,
);

const SensitiveTemplate = tree(`template $GoWebSensitive : Adw.Bin {
    child: Gtk.Box {
        Gtk.Button btn { sensitive: bind template.enabled; }
        Gtk.Switch sw { sensitive: bind template.enabled inverted; }
        Gtk.Label lbl { sensitive: bind template.enabled; }
    };
}`);

class GoWebSensitive extends Adw.Bin {
    declare _btn: HTMLButtonElement;
    declare _sw: HTMLElement & { disabled: boolean };
    declare _lbl: HTMLElement;
    declare enabled: boolean;
    constructor(params?: Record<string, unknown>) {
        // @ts-expect-error the element's own constructor takes none; the registered class's takes the params
        super(params);
    }
}
GObject.registerClass(
    {
        GTypeName: 'GoWebSensitive',
        Template: SensitiveTemplate,
        InternalChildren: ['btn', 'sw', 'lbl'],
        Properties: { enabled: GObject.ParamSpec.boolean('enabled', '', '', GObject.ParamFlags.READWRITE, true) },
    },
    GoWebSensitive as never,
);

export const GObjectDoorTest = async () => {
    await driveGObjectVectors(subject, { describe, it, expect }, GOBJECT_VECTORS);
    await describe('adwaita-web: GObject.registerClass end to end (ADR 0096)', async () => {
        await it('derives the tag from the GTypeName', () => {
            expect(tagForTypeName('Hexdump')).toBe('gjsify-hexdump');
            expect(customElements.get('gjsify-go-web-hexdump')).toBe(GoWebHexdump);
        });
        await it('refuses a second class under the same tag', () => {
            expect(() =>
                GObject.registerClass({ GTypeName: 'GoWebHexdump' }, class extends Adw.Bin {} as never),
            ).toThrow('already defines');
        });
        await it('MEASURED: a bare element dispatches no notify before its first connect, a connected-through-the-door one does', () => {
            const bare = document.createElement('gtk-switch') as HTMLElement & { active: boolean };
            let heard = 0;
            bare.addEventListener('notify::active', () => heard++);
            bare.active = true;
            expect(heard).toBe(0);
            const el = new GoWebHexdump();
            let viaDoor = 0;
            (el._sw as unknown as { connect(s: string, h: () => void): number }).connect(
                'notify::active',
                () => viaDoor++,
            );
            el._sw.active = true;
            expect(viaDoor).toBe(1);
        });
        for (const how of ['new', 'createElement'] as const) {
            await it(`built with ${how}: this._x after super, children after connect, bind and handler work`, () => {
                const el = (
                    how === 'new' ? new GoWebHexdump() : document.createElement('gjsify-go-web-hexdump')
                ) as GoWebHexdump;
                expect(el._sw !== undefined).toBe(true);
                expect(el.children.length).toBe(0);
                expect(el.seenInConstructor).toBe(true);
                // notify on a not-yet-connected element reaches the binding (ADR 0096 UNVERIFIED point)
                el._sw.active = true;
                expect(el.enabled).toBe(true);
                el.enabled = false;
                expect(el._sw.active).toBe(false);
                document.body.append(el);
                try {
                    expect(el.querySelector('gtk-switch') !== null).toBe(true);
                    expect(el.contains(el._btn)).toBe(true);
                    el._btn.dispatchEvent(new Event('click'));
                    expect(el.clicks).toBe(11);
                    el._sw.active = true;
                    expect(el.enabled).toBe(true);
                } finally {
                    el.remove();
                }
            });
        }
    });
    await describe('adwaita-web: Gtk.Widget:sensitive in a template bind', async () => {
        await it('binds sensitive to a template property, following it both ways of the flag', () => {
            const el = new GoWebSensitive();
            expect(el._btn.hasAttribute('disabled')).toBe(false);
            expect(el._lbl.getAttribute('aria-disabled')).toBe(null);
            el.enabled = false;
            expect(el._btn.hasAttribute('disabled')).toBe(true);
            expect((el._btn as unknown as { sensitive: boolean }).sensitive).toBe(false);
            expect(el._lbl.getAttribute('aria-disabled')).toBe('true');
            expect(el._sw.hasAttribute('disabled')).toBe(false);
            el.enabled = true;
            expect(el._btn.hasAttribute('disabled')).toBe(false);
            expect(el._lbl.getAttribute('aria-disabled')).toBe(null);
            expect(el._sw.hasAttribute('disabled')).toBe(true);
        });
    });
    await describe('adwaita-web: a signal is per instance, as in GObject', async () => {
        const nested = (tag: string) => {
            const parent = document.createElement(tag) as HTMLElement;
            const child = document.createElement(tag) as HTMLElement;
            parent.append(child);
            document.body.append(parent);
            return { parent, child };
        };
        await it('notify::visible-child-name of a child stack is not heard on the parent', () => {
            const { parent, child } = nested('adw-view-stack');
            let heard = 0;
            listenElement(parent, 'notify::visible-child-name', () => heard++);
            child.dispatchEvent(new CustomEvent('notify::visible-child-name', { bubbles: true }));
            expect(heard).toBe(0);
            parent.dispatchEvent(new CustomEvent('notify::visible-child-name', { bubbles: true }));
            expect(heard).toBe(1);
            parent.remove();
        });
        await it('activated of a child row is not heard on the parent, but still bubbles in the DOM', () => {
            const { parent, child } = nested('adw-action-row');
            let heard = 0;
            let bubbled = 0;
            listenElement(parent, 'activated', () => heard++);
            parent.addEventListener('activated', () => bubbled++);
            child.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
            expect(heard).toBe(0);
            expect(bubbled).toBe(1);
            parent.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
            expect(heard).toBe(1);
            parent.remove();
        });
        await it('clicked of a nested button is not heard on the outer one; a click on plain content is', () => {
            const { parent, child } = nested('gtk-button');
            const inner = document.createElement('span');
            parent.append(inner);
            let heard = 0;
            listenElement(parent, 'clicked', () => heard++);
            child.dispatchEvent(new Event('click', { bubbles: true }));
            expect(heard).toBe(0);
            inner.dispatchEvent(new Event('click', { bubbles: true }));
            expect(heard).toBe(1);
            parent.remove();
        });
    });
    await describe('adwaita-web: a bare element has the GObject signal API', async () => {
        await it('connects to a signal on createElement, and disconnects by id', () => {
            const stack = document.createElement('adw-view-stack') as HTMLElement & {
                connect(signal: string, handler: () => void): number;
                disconnect(id: number): void;
            };
            document.body.append(stack);
            let heard = 0;
            const id = stack.connect('notify::visible-child-name', () => heard++);
            stack.dispatchEvent(new CustomEvent('notify::visible-child-name'));
            expect(heard).toBe(1);
            stack.disconnect(id);
            stack.dispatchEvent(new CustomEvent('notify::visible-child-name'));
            expect(heard).toBe(1);
            stack.remove();
        });
        await it('connects to clicked on a bare button', () => {
            const button = document.createElement('gtk-button') as HTMLElement & {
                connect(signal: string, handler: () => void): number;
            };
            let heard = 0;
            button.connect('clicked', () => heard++);
            button.click();
            expect(heard).toBe(1);
        });
        await it('refuses a signal the element does not declare', () => {
            const button = document.createElement('gtk-button') as HTMLElement & {
                connect(signal: string, handler: () => void): number;
            };
            expect(() => button.connect('no-such-signal', () => {})).toThrow();
        });
    });
};
