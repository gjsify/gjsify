// ADR 0096: `gi://GObject` answered by the renderer, and a class registered the GNOME way.
// The template is a real `.blp?template` import (a corpus file, so the corpus gate keeps owning
// it): a property, a signal handler and `bind template.enabled bidirectional`, built under `new`.
import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import hexdump from '../../../../packages/nativescript-bridge/adwaita/src/gobject-door.blp?template';

export const button = Gtk.Button;
export const kind = typeof GObject.registerClass;

export class ProbeButton extends Gtk.Button {}

// `registerClass` splices a layer beneath the class (ADR 0096), so the direct prototype is not
// `Gtk.Button`; descent is what the subset promises.
export const descends = ProbeButton.prototype instanceof Gtk.Button;

GObject.registerClass(
    {
        GTypeName: 'GiArmsProbeButton',
        Properties: {
            enabled: GObject.ParamSpec.boolean('enabled', '', '', GObject.ParamFlags.READWRITE, false),
        },
        Signals: { copied: {} },
    },
    ProbeButton,
);

class ProbeHexdump extends Adw.Bin {
    declare _toggle: { active: boolean };
    declare _copyButton: { emit(signal: string): void };
    declare enabled: boolean;
    copies = 0;
    onCopy(): void {
        this.copies++;
    }
}

GObject.registerClass(
    {
        GTypeName: 'GoNsHexdump',
        Template: hexdump,
        InternalChildren: ['toggle', 'copyButton'],
        Properties: {
            enabled: GObject.ParamSpec.boolean('enabled', '', '', GObject.ParamFlags.READWRITE, false),
        },
    },
    ProbeHexdump,
);

/** What the template did: the bind both ways and the signal handler, read off a live instance. */
export function exercise(): Record<string, unknown> {
    const instance = new ProbeHexdump();
    const initial = instance._toggle.active;
    instance.enabled = true;
    const propertyToChild = instance._toggle.active;
    instance._toggle.active = false;
    const childToProperty = instance.enabled;
    instance._copyButton.emit('clicked');
    return { initial, propertyToChild, childToProperty, copies: instance.copies };
}
