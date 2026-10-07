// ADR 0096: the web door of the GObject subset, against the shared vectors and end to end.
import { parseBlueprint, projectToSharedNode } from '@gjsify/blueprint';
import { GOBJECT_VECTORS, driveGObjectVectors, type GObjectSubject } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { Adw, GObject } from './index.js';
import { tagForTypeName } from './gobject-door.js';
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
};
