// What both GTK CSS documents on the display share: they are probed before they are
// loaded, and they are installed the same way.
//
// This is `sheet.ts` decision 2, lifted out because there are now TWO documents on
// the display and the discipline is the same one. GTK's CSS parser recovers from a
// bad DECLARATION by dropping it, but a malformed CONSTRUCT can end the document —
// every rule after it is then silently absent, which presents as "the application
// lost its styling" with no error anywhere near the cause. In the measured case (an
// unterminated string) GTK reported no error AT ALL.
//
// So a document is PROBED before it is loaded: it goes into a throwaway provider
// followed by a sentinel rule, the provider is serialised back, and it is accepted
// only if the sentinel survived the round trip. A behavioural test against the real
// parser rather than a model of its grammar, which is the only kind that cannot
// drift against a GTK upgrade.
//
// It lives here rather than as a method on `StyleSheet` because an APPLICATION's own
// theme document is exactly the input that most deserves it — it is the one this
// package did not generate — and a second copy of the probe would be a second
// answer to "is this document safe", diverging on the first fix.
//
// `installProvider` is here for the same reason and arrived the same way: resolving
// the display, refusing when there is none, and adding at a priority was written
// twice, differing only in the noun inside the error text. One answer to "where does
// a document go", and it returns the display it used so a caller that later has to
// take the document off again removes it from the display it installed on rather
// than from whatever `get_default()` answers by then.

import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

/** A document GTK refused, or one that would have discarded what follows it. */
export class StyleSheetError extends Error {
    override readonly name = 'StyleSheetError';
    constructor(message: string) {
        super(`@gjsify/gtk-host/style: ${message}`);
    }
}

/** The sentinel a containment probe looks for. Its own name cannot collide. */
const PROBE_CLASS = 'gjsify-probe-8f3a91c4';
const PROBE_RULE = `.${PROBE_CLASS} { color: rgb(1 2 3); }`;

/**
 * Refuse a document that would take everything after it with it.
 *
 * `subject` names what is being loaded, because the two callers have very different
 * readers: a generated rule is this package's bug, and an application's theme
 * document is the application's.
 */
export function assertContained(document: string, subject: string): void {
    const probe = new Gtk.CssProvider();
    const errors: string[] = [];
    const handler = probe.connect('parsing-error', (_provider, _section, error) => {
        errors.push(error.message);
    });
    probe.load_from_string(`${document}\n${PROBE_RULE}`);
    probe.disconnect(handler);
    const survived = probe.to_string().includes(PROBE_CLASS);
    if (!survived) {
        throw new StyleSheetError(
            `${subject} would disable every rule after it in the document, so it is refused:\n  ${document}\n` +
                (errors.length > 0
                    ? `  GTK said: ${errors.join('; ')}`
                    : '  GTK reported no error, which is why this is checked by containment rather than by the error signal.'),
        );
    }
    if (errors.length > 0) {
        throw new StyleSheetError(`GTK refused a declaration in ${subject}:\n  ${document}\n  ${errors.join('; ')}`);
    }
}

/**
 * Put a provider on a display at `priority`, and say which display that was.
 *
 * `subject` names what is being installed, because the failure a caller has to act
 * on is "there is no display yet" and the fix depends on which document it is.
 */
export function installProvider(
    provider: Gtk.CssProvider,
    subject: string,
    display: Gdk.Display | null | undefined,
    priority: number,
): Gdk.Display {
    const target = display ?? Gdk.Display.get_default();
    if (target === null) {
        throw new StyleSheetError(
            `there is no Gdk display to install ${subject} on. Install it after Gtk.init(), or pass one explicitly.`,
        );
    }
    Gtk.StyleContext.add_provider_for_display(target, provider, priority);
    return target;
}
