// A stable, diffable text form of a parsed tree.
//
// It exists so two DIFFERENT tree implementations can be compared with one
// `toBe`. `canonicalize` never touches a node class: it reads through a
// `TreeReader`, so the same function serializes our nodes and a reference
// parser's nodes, and there is no second canonicalizer to agree with the first
// on the same mistake (ADR 0026 § Decision 7).
//
// Two uses today: the committed golden that freezes the XML tree shape, and the
// differential suite in `tests/integration/domparser/`.

/** One attribute, in the two parts every tree model agrees on. */
export interface ReadAttribute {
    name: string;
    value: string;
}

/**
 * The minimum a tree has to answer to be canonicalized. Implemented once per
 * tree model; `TNode` is that model's node type.
 */
export interface TreeReader<TNode> {
    isElement(node: TNode): boolean;
    isText(node: TNode): boolean;
    isComment(node: TNode): boolean;
    isDoctype(node: TNode): boolean;
    /** Lowercase local name for an element, the declared name for a doctype. */
    name(node: TNode): string;
    /** Character data for text and comment nodes. */
    value(node: TNode): string;
    attributes(node: TNode): ReadAttribute[];
    children(node: TNode): TNode[];
}

/**
 * Quote a string so a newline, a tab or a quote cannot forge the line structure
 * the canonical form is read by. `\` goes first — escaping it after the others
 * would double their backslashes.
 */
function quote(value: string): string {
    const escaped = value
        .split('\\')
        .join('\\\\')
        .split('"')
        .join('\\"')
        .split('\n')
        .join('\\n')
        .split('\r')
        .join('\\r')
        .split('\t')
        .join('\\t');
    return '"' + escaped + '"';
}

function line<TNode>(reader: TreeReader<TNode>, node: TNode): string {
    // Character data prints under the node's OWN name, so an XML CDATA section
    // does not canonicalize to the same line as a plain text node.
    if (reader.isText(node) || reader.isComment(node)) {
        return reader.name(node) + ' ' + quote(reader.value(node));
    }
    if (reader.isDoctype(node)) return '#doctype ' + quote(reader.name(node));
    // A document or a fragment: it has no attributes, only a name and children.
    if (!reader.isElement(node)) return reader.name(node);

    // Sorted by name: attribute ORDER is not part of any tree's contract, so
    // comparing it would report a difference that is not one.
    const attrs = reader
        .attributes(node)
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((a) => ' ' + a.name + '=' + quote(a.value))
        .join('');
    return reader.name(node) + attrs;
}

function walk<TNode>(reader: TreeReader<TNode>, node: TNode, depth: number, out: string[]): void {
    out.push('  '.repeat(depth) + line(reader, node));
    for (const child of reader.children(node)) walk(reader, child, depth + 1, out);
}

/**
 * Serialize `root` and its descendants, one indented line per node. The root
 * line is included, so a fixture that parsed to nothing is one line long and
 * cannot be mistaken for a match.
 */
export function canonicalize<TNode>(reader: TreeReader<TNode>, root: TNode): string {
    const out: string[] = [];
    walk(reader, root, 0, out);
    return out.join('\n');
}
