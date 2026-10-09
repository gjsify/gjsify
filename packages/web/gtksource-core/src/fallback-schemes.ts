// A small style scheme of this package's own, registered under the ids `Adwaita` and
// `Adwaita-dark` ONLY because Learn6502-style schemes name those as `parent-scheme`.
//
// GtkSourceView's real Adwaita scheme and `def.lang` are LGPL and are NOT bundled here: the
// colours below are this package's own choice and say so in their name. A consumer that has
// the real files calls `StyleSchemeManager.addSchemeFromXml()` with the same id and replaces
// these. The set of `def:` styles is the one the shipped languages map their styles to.

const scheme = (id: string, name: string, styles: Record<string, string>): string => {
    const lines = Object.entries(styles).map(([style, attributes]) => `  <style name="${style}" ${attributes}/>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<style-scheme id="${id}" name="${name}" version="1.0">\n${lines.join('\n')}\n</style-scheme>\n`;
};

export const FALLBACK_LIGHT_ID = 'Adwaita';
export const FALLBACK_DARK_ID = 'Adwaita-dark';

export const fallbackLightScheme = scheme(FALLBACK_LIGHT_ID, 'Adwaita (gjsify fallback)', {
    text: 'foreground="#2e3436" background="#ffffff"',
    selection: 'background="#a8c8f0"',
    cursor: 'foreground="#2e3436"',
    'current-line': 'background="#f0f0f0"',
    'line-numbers': 'foreground="#8a8f92" background="#f6f5f4"',
    'current-line-number': 'foreground="#2e3436" background="#f0f0f0"',
    'def:comment': 'foreground="#77767b" italic="true"',
    'def:shebang': 'foreground="#77767b" italic="true"',
    'def:doc-comment-element': 'foreground="#77767b" italic="true"',
    'def:keyword': 'foreground="#a51d2d" bold="true"',
    'def:statement': 'foreground="#a51d2d" bold="true"',
    'def:preprocessor': 'foreground="#813d9c"',
    'def:type': 'foreground="#1a5fb4"',
    'def:builtin': 'foreground="#1a5fb4"',
    'def:function': 'foreground="#1a5fb4"',
    'def:identifier': 'foreground="#1a5fb4"',
    'def:constant': 'foreground="#26a269"',
    'def:number': 'foreground="#26a269"',
    'def:decimal': 'foreground="#26a269"',
    'def:base-n-integer': 'foreground="#26a269"',
    'def:floating-point': 'foreground="#26a269"',
    'def:boolean': 'foreground="#26a269"',
    'def:string': 'foreground="#c64600"',
    'def:character': 'foreground="#c64600"',
    'def:special-char': 'foreground="#c64600" bold="true"',
    'def:special-constant': 'foreground="#c64600"',
    'def:operator': 'foreground="#5e5c64"',
    'def:error': 'foreground="#c01c28" underline="error"',
    'def:note': 'foreground="#813d9c" bold="true"',
});

export const fallbackDarkScheme = scheme(FALLBACK_DARK_ID, 'Adwaita Dark (gjsify fallback)', {
    text: 'foreground="#ebebeb" background="#1e1e1e"',
    selection: 'background="#35516e"',
    cursor: 'foreground="#ebebeb"',
    'current-line': 'background="#2a2a2a"',
    'line-numbers': 'foreground="#8a8a8a" background="#242424"',
    'current-line-number': 'foreground="#ebebeb" background="#2a2a2a"',
    'def:comment': 'foreground="#9a9996" italic="true"',
    'def:shebang': 'foreground="#9a9996" italic="true"',
    'def:doc-comment-element': 'foreground="#9a9996" italic="true"',
    'def:keyword': 'foreground="#ff7b63" bold="true"',
    'def:statement': 'foreground="#ff7b63" bold="true"',
    'def:preprocessor': 'foreground="#dc8add"',
    'def:type': 'foreground="#78aeed"',
    'def:builtin': 'foreground="#78aeed"',
    'def:function': 'foreground="#78aeed"',
    'def:identifier': 'foreground="#78aeed"',
    'def:constant': 'foreground="#8ff0a4"',
    'def:number': 'foreground="#8ff0a4"',
    'def:decimal': 'foreground="#8ff0a4"',
    'def:base-n-integer': 'foreground="#8ff0a4"',
    'def:floating-point': 'foreground="#8ff0a4"',
    'def:boolean': 'foreground="#8ff0a4"',
    'def:string': 'foreground="#ffbe6f"',
    'def:character': 'foreground="#ffbe6f"',
    'def:special-char': 'foreground="#ffbe6f" bold="true"',
    'def:special-constant': 'foreground="#ffbe6f"',
    'def:operator': 'foreground="#c0bfbc"',
    'def:error': 'foreground="#ff7b63" underline="error"',
    'def:note': 'foreground="#dc8add" bold="true"',
});
