// The generated stylesheet: declarations in, a class name out, one provider on the
// display.
//
// This is the piece between the partition and the screen. `partition()` answers
// "which declarations", and a widget takes `css-classes` — so something has to turn
// a set of declarations into a NAME, and keep a document that defines it.
//
// THREE DECISIONS, EACH WITH A REASON THAT IS NOT OBVIOUS.
//
// 1. **Class names are content-addressed.** Two elements with the same declarations
//    get the same class and the document holds one rule, not one per element. A
//    per-element name is the shape that makes a long list re-parse the whole sheet
//    on every row.
//
// 2. **A rule is PROBED before it joins the document.** GTK's CSS parser recovers
//    per declaration, but a malformed construct can make it discard everything that
//    FOLLOWS in the same document — so one bad generated rule can silently unstyle
//    an entire application. Each new rule is therefore loaded into a throwaway
//    provider together with a sentinel rule, and accepted only if the sentinel
//    survives the round trip. That is a behavioural test against the real parser
//    rather than a model of its grammar, which is the only kind that cannot drift.
//
// 3. **Reload is coalesced.** Mounting a tree produces one rule per distinct style,
//    and reloading the document per rule is quadratic. The document is rebuilt once
//    per microtask instead.
//
// The variant support is deliberately narrow: a variant becomes a CSS pseudo-class
// on the same generated name (`active:` → `:active`). That is what makes a pressed
// style free — GTK animates the state itself, and nothing has to reach the
// reconciler when a finger goes down.

import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

/** A variant this sheet knows how to express, and the pseudo-class it becomes. */
export const VARIANT_PSEUDO: Readonly<Record<string, string>> = {
    active: ':active',
    hover: ':hover',
    focus: ':focus',
    disabled: ':disabled',
};

/** A rule GTK refused, or one that would have poisoned the document. */
export class StyleSheetError extends Error {
    override readonly name = 'StyleSheetError';
    constructor(message: string) {
        super(`@gjsify/gtk-host/style: ${message}`);
    }
}

/**
 * A stable, short name for a set of declarations.
 *
 * FNV-1a over the rule text. Not a cryptographic hash and not trying to be: the
 * only requirement is that equal declaration sets produce equal names and unequal
 * ones almost never collide — and a collision is not silent here, because the
 * document keys by the full rule text and a second rule with the same name and
 * different text is reported rather than merged.
 */
function hashName(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `gjsify-s${hash.toString(36)}`;
}

/** The sentinel a containment probe looks for. Its own name cannot collide. */
const PROBE_CLASS = 'gjsify-probe-8f3a91c4';
const PROBE_RULE = `.${PROBE_CLASS} { color: rgb(1 2 3); }`;

export interface StyleSheetOptions {
    /**
     * Where the provider is installed. Omitted means the default display — the
     * right answer for an application and the wrong one for a test, which is why
     * it is injectable at all.
     */
    readonly display?: Gdk.Display | null;
    /** Provider priority. Defaults to `STYLE_PROVIDER_PRIORITY_APPLICATION`. */
    readonly priority?: number;
}

export class StyleSheet {
    readonly #provider = new Gtk.CssProvider();
    /** class name → the rule text that defines it. */
    readonly #rules = new Map<string, string>();
    #installed = false;
    #reloadQueued = false;
    readonly #options: StyleSheetOptions;

    constructor(options: StyleSheetOptions = {}) {
        this.#options = options;
    }

    /**
     * Register `declarations` (and optional variants) and return their class name.
     *
     * Idempotent: the same declarations always yield the same name and the document
     * gains nothing the second time.
     */
    classFor(declarations: readonly string[], variants: Readonly<Record<string, readonly string[]>> = {}): string {
        if (declarations.length === 0 && Object.keys(variants).length === 0) {
            throw new StyleSheetError('classFor was given no declarations — an empty class would name nothing');
        }

        const body = declarations.join('; ');
        const parts: string[] = [];
        // The base rule first: a variant must be able to override it, and GTK
        // resolves equal specificity by SHEET ORDER rather than by selector order.
        const signature = `${body}|${Object.entries(variants)
            .map(([name, decls]) => `${name}{${decls.join('; ')}}`)
            .sort()
            .join('')}`;
        const name = hashName(signature);

        const existing = this.#rules.get(name);
        if (existing !== undefined) return name;

        if (declarations.length > 0) parts.push(`.${name} { ${body}; }`);
        for (const [variant, variantDeclarations] of Object.entries(variants)) {
            const pseudo = VARIANT_PSEUDO[variant];
            if (pseudo === undefined) {
                throw new StyleSheetError(
                    `"${variant}:" is not a variant this sheet can express. Known: ${Object.keys(VARIANT_PSEUDO).sort().join(', ')}. ` +
                        'A variant becomes a GTK CSS pseudo-class, so one without a pseudo-class equivalent needs a different mechanism.',
                );
            }
            if (variantDeclarations.length === 0) continue;
            parts.push(`.${name}${pseudo} { ${variantDeclarations.join('; ')}; }`);
        }

        const rule = parts.join('\n');
        this.#assertContained(rule);
        this.#rules.set(name, rule);
        this.#queueReload();
        return name;
    }

    /** The document as GTK sees it. Exposed because a test that cannot read it proves nothing. */
    toString(): string {
        return [...this.#rules.values()].join('\n');
    }

    /** How many distinct rules the document holds. */
    get size(): number {
        return this.#rules.size;
    }

    /**
     * Load the document now, rather than on the next microtask.
     *
     * A test has no microtask checkpoint it can rely on, and an application that is
     * about to present a window wants the styles already in place.
     */
    flush(): void {
        this.#reloadQueued = false;
        this.#provider.load_from_string(this.toString());
        if (this.#installed) return;
        const display = this.#options.display ?? Gdk.Display.get_default();
        if (display === null) {
            throw new StyleSheetError(
                'there is no Gdk display to install the stylesheet on. Construct the sheet after Gtk.init(), or pass one explicitly.',
            );
        }
        Gtk.StyleContext.add_provider_for_display(
            display,
            this.#provider,
            this.#options.priority ?? Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
        this.#installed = true;
    }

    #queueReload(): void {
        if (this.#reloadQueued) return;
        this.#reloadQueued = true;
        queueMicrotask(() => {
            if (this.#reloadQueued) this.flush();
        });
    }

    /**
     * Refuse a rule that would take the rest of the document with it.
     *
     * GTK recovers from a bad DECLARATION by dropping it, but a malformed construct
     * can end the document — every rule after it is then silently absent, which
     * presents as "the application lost its styling" with no error anywhere. The
     * probe asks the real parser: load `<rule>` followed by a sentinel, serialise
     * back, and check the sentinel is still there.
     */
    #assertContained(rule: string): void {
        const probe = new Gtk.CssProvider();
        const errors: string[] = [];
        const handler = probe.connect('parsing-error', (_provider, _section, error) => {
            errors.push(error.message);
        });
        probe.load_from_string(`${rule}\n${PROBE_RULE}`);
        probe.disconnect(handler);
        const survived = probe.to_string().includes(PROBE_CLASS);
        if (!survived) {
            throw new StyleSheetError(
                `a generated rule would disable every rule after it in the document, so it is refused:\n  ${rule}\n` +
                    (errors.length > 0 ? `  GTK said: ${errors.join('; ')}` : '  GTK reported no error, which is why this is checked by containment rather than by the error signal.'),
            );
        }
        if (errors.length > 0) {
            throw new StyleSheetError(`GTK refused a generated declaration:\n  ${rule}\n  ${errors.join('; ')}`);
        }
    }
}
