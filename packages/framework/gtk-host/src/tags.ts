/**
 * GType name <-> kebab tag, and the map must be INJECTIVE.
 *
 * Two spellings exist because two dialects insist on different ones, and the
 * difference is measured rather than chosen (ADR 0028 § 7):
 *
 *  - JSX intrinsic elements MUST be kebab. A capitalized `JSX.IntrinsicElements`
 *    key is never consulted — `<GtkBox/>` is `TS2304: Cannot find name 'GtkBox'`,
 *    because TypeScript reads a capitalized JSX name as a value reference.
 *  - A Vue `GlobalComponents` key is the GTYPE name. Volar resolves a kebab tag
 *    to EITHER spelling but a Pascal tag only to a Pascal key, so one key covers
 *    `<gtk-box>` and `<GtkBox>` both.
 *
 * The GType name therefore stays the table key, the GtkBuilder XML key and the
 * Vue key; kebab is the JSX spelling and an accepted registry alias.
 */

/** `GtkGLArea` -> `gtk-gl-area`, `AdwSpinRow` -> `adw-spin-row`, `GtkATContext` -> `gtk-at-context`. */
export function tagOf(gtype: string): string {
    const out: string[] = [];
    for (let i = 0; i < gtype.length; i++) {
        const c = gtype[i] as string;
        const prev = i > 0 ? (gtype[i - 1] as string) : '';
        const next = i + 1 < gtype.length ? (gtype[i + 1] as string) : '';
        const isUpper = c >= 'A' && c <= 'Z';
        if (isUpper && i > 0) {
            // A boundary is either the end of a lowercase/digit run, or the LAST
            // capital of an acronym run — the second case is what keeps `GLArea`
            // from becoming `g-l-area`.
            const endsLowerRun = !(prev >= 'A' && prev <= 'Z');
            const endsAcronym = next !== '' && next >= 'a' && next <= 'z';
            if (endsLowerRun || endsAcronym) out.push('-');
        }
        out.push(c.toLowerCase());
    }
    return out.join('');
}

/**
 * Refuse a table whose tags are not unique.
 *
 * A collision would make one of the two widgets unreachable by tag, silently —
 * so it is an error at generation time, never a warning in a log nobody reads.
 */
export function assertInjective(gtypes: readonly string[]): void {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const gtype of gtypes) {
        const tag = tagOf(gtype);
        const other = seen.get(tag);
        if (other) clashes.push(`${tag} <- ${other} and ${gtype}`);
        else seen.set(tag, gtype);
    }
    if (clashes.length > 0) {
        throw new Error(`tag map is not injective:\n  ${clashes.join('\n  ')}`);
    }
}
