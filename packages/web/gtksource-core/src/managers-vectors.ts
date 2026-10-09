// The manager and buffer surface slice 2 claims, as observable behaviour. The SAME vectors run on
// real `gi://GtkSource` (the ORACLE: a vector that fails there is wrong, never a port bug) and on
// every port's namespace door.

/** The part of `GtkSource` the vectors read. */
export interface GtkSourceManagersLike {
    LanguageManager: { get_default(): { get_language(id: string): unknown } };
    StyleSchemeManager: { get_default(): { get_scheme(id: string): { id: string } | null } };
    // `any`: the real constructor takes a GObject property bag, the port a string or the same bag.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Buffer: new (properties?: any) => { text: string; language: unknown };
}

export interface GtkSourceManagersVector {
    readonly rule: string;
    readonly observe: (GtkSource: GtkSourceManagersLike) => unknown;
    readonly shows: unknown;
}

export const GTKSOURCE_MANAGER_VECTORS: readonly GtkSourceManagersVector[] = [
    {
        rule: 'LanguageManager.get_default() is one instance',
        observe: (G) => G.LanguageManager.get_default() === G.LanguageManager.get_default(),
        shows: true,
    },
    {
        rule: 'get_language of an id nothing registered is null',
        observe: (G) => G.LanguageManager.get_default().get_language('no-such-language'),
        shows: null,
    },
    {
        rule: 'StyleSchemeManager.get_default() is one instance',
        observe: (G) => G.StyleSchemeManager.get_default() === G.StyleSchemeManager.get_default(),
        shows: true,
    },
    {
        rule: 'get_scheme of an id nothing registered is null',
        observe: (G) => G.StyleSchemeManager.get_default().get_scheme('no-such-scheme'),
        shows: null,
    },
    {
        rule: 'the stock Adwaita scheme is there and answers to its id',
        observe: (G) => G.StyleSchemeManager.get_default().get_scheme('Adwaita')?.id,
        shows: 'Adwaita',
    },
    {
        rule: 'a new Buffer holds the empty text',
        observe: (G) => new G.Buffer().text,
        shows: '',
    },
    {
        rule: 'a new Buffer has no language',
        observe: (G) => new G.Buffer().language,
        shows: null,
    },
    {
        rule: 'a Buffer built with a text property reads it back',
        observe: (G) => new G.Buffer({ text: 'LDA #$01' }).text,
        shows: 'LDA #$01',
    },
];
