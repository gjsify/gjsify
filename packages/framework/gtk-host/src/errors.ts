/**
 * Every failure this host reports names the tag, the property and the fix.
 *
 * The reason is measured, not stylistic: GTK's own failure mode is Exit 0.
 * Writing a string nick to an enum property is a SILENT no-op through both
 * `set_property()` and the JS setter (`box.orientation = 'vertical'` leaves it
 * at `HORIZONTAL`, gjs 1.88.1); writing a read-only property does not throw; and
 * a mis-parented widget floods stderr with `Gtk-WARNING` while the process still
 * exits 0. A renderer that stays quiet here produces a wrong window and a green
 * test run, so this host is loud on purpose.
 */
export class GtkHostError extends Error {
    override readonly name = 'GtkHostError';
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export const err = {
    unknownTag: (tag: string) =>
        new GtkHostError(
            'unknown-tag',
            `No descriptor registered for <${tag}>. Register one with registerWidget({ gtype: '${tag}', … }) ` +
                `or use a raw GType tag that is present in the installed typelib.`,
        ),
    unknownProp: (tag: string, prop: string) =>
        new GtkHostError(
            'unknown-prop',
            `<${tag}> has no property "${prop}". Check the spelling against the installed GTK ` +
                `(camelCase and kebab-case both resolve), or bind it as a signal with on${prop[0]?.toUpperCase()}${prop.slice(1)}.`,
        ),
    readOnlyProp: (tag: string, prop: string) =>
        new GtkHostError(
            'read-only-prop',
            `<${tag}>.${prop} is read-only in the installed GTK. Writing it is a silent no-op in GObject, ` +
                `so this host refuses it instead of dropping the value.`,
        ),
    badEnum: (tag: string, prop: string, nick: string, gtypeName: string) =>
        new GtkHostError(
            'bad-enum',
            `<${tag}>.${prop} expects ${gtypeName}, and "${nick}" is not one of its values. ` +
                `Note that GObject accepts the wrong string SILENTLY — the property would have kept its old value.`,
        ),
    badBoolean: (tag: string, prop: string, value: string) =>
        new GtkHostError(
            'bad-boolean',
            `<${tag}>.${prop} is a boolean and got the string "${value}". JS truthiness would make ` +
                `"false" mean TRUE — the exact silent-wrong-value this host exists to refuse. ` +
                `Pass a real boolean.`,
        ),
    badFlags: (tag: string, prop: string, value: string, gtypeName: string) =>
        new GtkHostError(
            'bad-flags',
            `<${tag}>.${prop} expects the flags type ${gtypeName}, and a string ("${value}") cannot be resolved to one. ` +
                `Pass the numeric value (bitwise-or the members). GObject would have dropped the string silently.`,
        ),
    unresolvableEnum: (gtypeName: string) =>
        new GtkHostError(
            'unresolvable-enum',
            `Cannot resolve the enum type ${gtypeName} to a GI namespace. Pass the numeric value instead, ` +
                `or extend ENUM_NAMESPACES in props.ts.`,
        ),
    textNotAccepted: (tag: string, text: string) =>
        new GtkHostError(
            'text-not-accepted',
            `<${tag}> has no text sink, so the text ${JSON.stringify(text.slice(0, 32))} has nowhere to go. ` +
                `Wrap it in a widget that takes text (<GtkLabel>), or set the property directly.`,
        ),
    unclaimedChild: (parentTag: string, childTag: string) =>
        new GtkHostError(
            'unclaimed-child',
            `<${parentTag}> declares children: { kind: 'none' }, so it cannot adopt <${childTag}>. ` +
                `Fix one of three things: give the parent a child policy, wrap the child in a container, ` +
                `or set the child on a property (e.g. a "child" or "content" property).`,
        ),
    unknownSlot: (parentTag: string, slot: string, known: string[]) =>
        new GtkHostError('unknown-slot', `<${parentTag}> has no slot "${slot}". Known slots: ${known.join(', ')}.`),
    rejectedChild: (parentTag: string, childTag: string, reason: string) =>
        new GtkHostError(
            'rejected-child',
            `<${parentTag}> refused <${childTag}>: ${reason}. The container accepts only certain child types ` +
                `(e.g. AdwPreferencesPage takes AdwPreferencesGroup); the descriptor cannot know that, GTK does.`,
        ),
    notAWidget: (tag: string) =>
        new GtkHostError(
            'not-a-widget',
            `<${tag}> is not a Gtk.Widget, so it cannot be placed as a child. ` +
                `Non-widget GObjects (controllers, filters, models) attach to a property, not to a parent.`,
        ),
    constructOnlyLate: (tag: string, prop: string) =>
        new GtkHostError(
            'construct-only-late',
            `<${tag}>.${prop} is construct-only and the widget already exists. ` +
                `The host rebuilds on construct-only changes; reaching this error means the rebuild path was bypassed.`,
        ),
};
