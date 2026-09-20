// The lexer and parser for the Blueprint subset ADR 0053 clause 1 puts in front of the
// GtkBuilder emitter and the `SharedNode` projection. It produces the shape `ast.d.mts`
// declares and nothing else — no XML, no GIR, no resolution.
//
// WHY THIS FILE HAS NO DEPENDENCIES, NOT EVEN `node:fs`
//
// `scripts/check-blueprint-corpus.mjs` imports the parser through `src/index.mjs`, as plain
// Node, in `tree-checks` — a job that installs the workspace and does NOT build it. So the parser is
// `.mjs` beside its own declarations, and it is handed TEXT rather than a path: the caller
// owns the reading, which is also what lets the shadow arm feed it a string it never wrote
// to disk.
//
// WHY EVERY REFUSAL IS AN EXCEPTION AND NEVER A SKIP
//
// ADR 0053 clause 3: scope is a SUBSET and an unrecognised construct is a hard error naming
// its line, "never a silent pass-through, because output that looks plausible and means
// something else is the defect a hand-written parser most easily introduces". Every branch
// below that cannot proceed therefore throws — there is no recovery path, no `continue` past
// an unknown token, and no partial AST returned. A construct this file refuses is the next
// unit of work under clause 5, and it is refused by NAME so the refusal reads as a to-do
// rather than as a bug.
//
// WHERE THE GRAMMAR CAME FROM
//
// Read off `blueprint-compiler` 0.20.4 — the ORACLE `corpus/manifest.mjs` pins — from
// `tokenizer.py` (`_tokens`, whose ORDER this file's lexer reproduces) and from the
// `grammar` of each `language/*.py` node. Where a rule below is narrower than that grammar
// it says so, and where a rule was settled by RUNNING the compiler rather than by reading it
// the comment names the measurement.
//
// WHY THE PARSER NEVER LOOKS AT THE SOURCE TEXT AGAIN
//
// `ast.d.mts` § WHY EVERY NODE CARRIES A LINE: a line recovered afterwards by re-scanning is
// a second reader of the same text, and the two disagree the first time a string contains a
// newline. So the lexer is the only thing in this file that ever indexes `source`, every
// token carries the line and column it started on, and every node copies the line of the
// token that started IT. The distinction that forces this is live in `16-string-escapes.blp`:
// `"… a newline \n"` DECODES to a string holding a newline while its RAW source spans one
// line, and blueprint's own string regex admits the opposite case too — a backslash before a
// real newline is a line continuation, so a raw token can span lines while its value holds
// exactly one newline. The lexer counts newlines in the RAW slice and nothing else.

/**
 * @import { BlueprintFile, BlueprintImport, TopLevel, TypeRef, ObjectNode, ObjectBody, TemplateNode } from './ast.d.mts'
 * @import { Property, Signal, Child, Extension, ExtensionEntry, MenuAttribute, MenuNode, MenuItem } from './ast.d.mts'
 * @import { Value, StringValue, ListValue, BindingValue, Expression } from './ast.d.mts'
 */
import { BUILTIN_GTYPES } from './builtin-types.mjs';
import { BlueprintSyntaxError, SUBSET_NOTE } from './errors.mjs';
import { numberLiteral } from './number-literal.mjs';

// ---------------------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------------------

/**
 * The token patterns, in `blueprint-compiler` 0.20.4's own order (`tokenizer.py` `_tokens`).
 *
 * The order is load-bearing twice over and must not be tidied alphabetically. IDENT before
 * NUMBER is what makes the `_` of `_("x")` an identifier rather than a lex failure — its
 * pattern starts `[A-Za-z_]`. And COMMENT before OP is what keeps `//` from lexing as two
 * `/` operators, since `/` is a legal operator in the same grammar.
 *
 * `trivia` (whitespace and both comment forms) is dropped rather than emitted, which is how
 * comments "reach no AST node": there is no position in the parser below that can see one.
 *
 * @type {readonly (readonly [string, RegExp])[]}
 */
const TOKEN_PATTERNS = [
    ['ident', /[A-Za-z_][\w-]*/y],
    // `\\[\s\S]` and not `\\.`: a backslash may precede a REAL newline (a line continuation
    // that decodes to a newline), which is the only way a string token spans lines.
    ['string', /"(?:\\[\s\S]|[^\\"\n])*"/y],
    ['string', /'(?:\\[\s\S]|[^\\'\n])*'/y],
    ['number', /0x[A-Za-z0-9_]+/y],
    ['number', /[\d_]+(?:\.[\d_]+)?/y],
    ['number', /\.[\d_]+/y],
    ['trivia', /\s+/y],
    ['trivia', /\/\*[\s\S]*?\*\//y],
    ['trivia', /\/\/[^\n]*/y],
];

/**
 * Operators, longest-first within a shared prefix so `::` never lexes as two `:` and `=>`
 * never as `=` followed by `>`. The set is the oracle's whole operator set and not only the
 * part this subset uses: lexing `<<` as one token lets the PARSER refuse it by name, where a
 * lexer failure could only say "unexpected character".
 */
const OPERATORS = ['=>', '::', '<<', '>>', ':=', '||', '$', '<', '>', '.', '|', '+', '-', '*', '=', ':', '/'];

const PUNCTUATION = ['(', ')', '{', '}', ';', '[', ']', ','];

/**
 * `blueprintcompiler/utils.py` `unescape_quote`, exactly. An escape outside this table is an
 * error there and is an error here — silently keeping `\q` as `q` would be a decoded string
 * the source never wrote.
 */
const STRING_ESCAPES = new Map([
    ['\n', '\n'],
    ['\\', '\\'],
    ['n', '\n'],
    ['t', '\t'],
    ['"', '"'],
    ["'", "'"],
]);

/**
 * @typedef {Object} Token
 * @property {'ident'|'number'|'string'|'operator'|'punctuation'|'eof'} type
 * @property {string} text   the raw source slice; for a string this still has its quotes
 * @property {string} value  decoded, for a string; equal to `text` otherwise
 * @property {number} line   1-based, the line the token STARTS on
 * @property {number} column 1-based
 */

/**
 * Decode a string token into the value `StringValue.value` carries.
 *
 * Walks the raw slice tracking line and column so a bad escape is reported where it stands
 * rather than at the opening quote — the same reason every node carries a line.
 *
 * @param {string} raw
 * @param {number} line
 * @param {number} column
 * @param {string} file
 * @returns {string}
 */
function decodeStringToken(raw, line, column, file) {
    let value = '';
    let currentLine = line;
    let currentColumn = column + 1;
    for (let index = 1; index < raw.length - 1; index++) {
        const character = raw[index];
        if (character !== '\\') {
            value += character;
            if (character === '\n') {
                currentLine++;
                currentColumn = 1;
            } else {
                currentColumn++;
            }
            continue;
        }
        const escape = raw[index + 1];
        const decoded = STRING_ESCAPES.get(escape);
        if (decoded === undefined) {
            throw new BlueprintSyntaxError(
                `invalid escape sequence \`\\${escape}\`, expected one of \\\\ \\n \\t \\" \\'`,
                file,
                currentLine,
                currentColumn,
            );
        }
        value += decoded;
        if (escape === '\n') {
            currentLine++;
            currentColumn = 1;
        } else {
            currentColumn += 2;
        }
        index++;
    }
    return value;
}

/**
 * @param {string} source
 * @param {string} file
 * @returns {Token[]}  always ending in exactly one `eof` token, so the parser never indexes past the end
 */
function tokenize(source, file) {
    /** @type {Token[]} */
    const tokens = [];
    let index = 0;
    let line = 1;
    let lineStart = 0;

    while (index < source.length) {
        const column = index - lineStart + 1;
        let matched = false;

        for (const [type, pattern] of TOKEN_PATTERNS) {
            pattern.lastIndex = index;
            const match = pattern.exec(source);
            if (match === null) {
                continue;
            }
            const text = match[0];
            if (type !== 'trivia') {
                tokens.push({
                    type: /** @type {Token['type']} */ (type),
                    text,
                    value: type === 'string' ? decodeStringToken(text, line, column, file) : text,
                    line,
                    column,
                });
            }
            // The line counter advances over the RAW slice. Whitespace and block comments are
            // the ordinary reason a token spans lines; a backslash-continued string is the
            // reason this cannot be `text.includes('\n') ? … : …` on the DECODED value.
            const lastNewline = text.lastIndexOf('\n');
            if (lastNewline !== -1) {
                line += text.split('\n').length - 1;
                lineStart = index + lastNewline + 1;
            }
            index += text.length;
            matched = true;
            break;
        }
        if (matched) {
            continue;
        }

        const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
        const punctuation = PUNCTUATION.find((candidate) => source.startsWith(candidate, index));
        const text = operator ?? punctuation;
        if (text === undefined) {
            // A quote reaching here means the string pattern did not match from it, and the
            // only way that happens is an unterminated literal — the pattern is anchored on
            // the closing quote and forbids a bare newline inside. Saying so beats the
            // oracle's "Could not determine what kind of syntax is meant here", which points
            // at the opening quote of a string whose real defect is a missing one.
            const character = source[index];
            const detail =
                character === '"' || character === "'"
                    ? 'unterminated string literal'
                    : `unexpected character \`${character}\`, expected a name, a value or punctuation`;
            throw new BlueprintSyntaxError(detail, file, line, column);
        }
        tokens.push({
            type: operator === undefined ? 'punctuation' : 'operator',
            text,
            value: text,
            line,
            column,
        });
        index += text.length;
    }

    tokens.push({ type: 'eof', text: '', value: '', line, column: index - lineStart + 1 });
    return tokens;
}

// ---------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------

/**
 * Blocks whose body is a `{ … }` of `name: value;` entries and whose contents are their own
 * vocabulary — `ast.d.mts` § `Extension`. The set is an ALLOWLIST and not a shape test
 * (`ident` followed by `{`), because that shape is also an unqualified object child:
 * `setters { }` and `Box { }` are the same three tokens. The oracle discriminates the same
 * way, by exact keyword — `Keyword("setters")` is case-sensitive there, so `Setters { }`
 * stays an object in both.
 */
const BLOCK_EXTENSIONS = new Set(['layout', 'accessibility', 'setters']);

/**
 * Properties whose value is a bracketed list of plain values — `ast.d.mts` § `ListValue`
 * names these three by example. They are `Property` nodes and NOT `Extension` nodes: a
 * `ListValue` is a `Value`, and the only place a `Value` lives is `Property.value`.
 */
const LIST_PROPERTIES = new Set(['styles', 'strings', 'widgets']);

const SIGNAL_FLAGS = new Set(['swapped', 'not-swapped', 'after']);

const BINDING_FLAGS = new Set(['inverted', 'bidirectional', 'no-sync-create', 'sync-create']);

const RESPONSE_FLAGS = new Set(['destructive', 'suggested', 'disabled']);

const MENU_ITEM_KEYWORDS = new Set(['section', 'submenu', 'item']);

/**
 * Extensions `blueprint-compiler` accepts inside an object body and this subset does not,
 * mapped to what to say when one turns up. Naming them beats letting them fall through to
 * the object-child branch, where `items [` would fail as "expected `{`" and read like a
 * broken file rather than like scope.
 */
const REFUSED_EXTENSIONS = new Map([
    ['items', 'the `items [ … ]` extension of Gtk.ComboBoxText'],
    ['marks', 'the `marks [ … ]` extension of Gtk.Scale'],
    ['offsets', 'the `offsets [ … ]` extension of Gtk.LevelBar'],
    ['mime-types', 'the `mime-types [ … ]` extension of Gtk.FileFilter'],
    ['patterns', 'the `patterns [ … ]` extension of Gtk.FileFilter'],
    ['suffixes', 'the `suffixes [ … ]` extension of Gtk.FileFilter'],
    ['template', 'the `template … { }` extension of Gtk.BuilderListItemFactory'],
]);

/** How a token reads inside "found …". */
function describe(/** @type {Token} */ token) {
    return token.type === 'eof' ? 'end of file' : `\`${token.text}\``;
}

class Parser {
    /**
     * @param {Token[]} tokens
     * @param {string} file
     */
    constructor(tokens, file) {
        this.tokens = tokens;
        this.file = file;
        this.position = 0;
    }

    /** @returns {Token} */
    peek(offset = 0) {
        return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
    }

    /** @returns {Token} */
    advance() {
        const token = this.peek();
        if (token.type !== 'eof') {
            this.position++;
        }
        return token;
    }

    /** Text equality is enough to identify a token: no operator spells an identifier. */
    at(/** @type {string} */ text, offset = 0) {
        return this.peek(offset).text === text;
    }

    /**
     * Built and RETURNED rather than thrown, so every call site reads `throw this.fail(…)`.
     * A helper that throws invisibly is a helper a reader has to remember the behaviour of.
     *
     * @returns {BlueprintSyntaxError}
     */
    fail(/** @type {Token} */ token, /** @type {string} */ message) {
        return new BlueprintSyntaxError(message, this.file, token.line, token.column);
    }

    /** @returns {Token} */
    expect(/** @type {string} */ text, /** @type {string} */ expected) {
        const token = this.peek();
        if (token.text !== text || token.type === 'eof') {
            throw this.fail(token, `found ${describe(token)}, expected ${expected}`);
        }
        return this.advance();
    }

    /** @returns {Token} */
    expectIdentifier(/** @type {string} */ expected) {
        const token = this.peek();
        if (token.type !== 'ident') {
            throw this.fail(token, `found ${describe(token)}, expected ${expected}`);
        }
        return this.advance();
    }

    /** @returns {BlueprintFile} */
    parseFile() {
        const first = this.peek();
        if (!this.at('using')) {
            throw this.fail(
                first,
                `found ${describe(first)}, expected \`using Gtk 4.0;\` — a blueprint file opens with the Gtk directive`,
            );
        }

        /** @type {BlueprintImport[]} */
        const imports = [];
        while (this.at('using')) {
            imports.push(this.parseImport());
        }
        // `imports[0]` is `GtkDirective` in the oracle's grammar and not an `Import`: the
        // namespace is matched literally, so a file opening with `using Adw 1;` is refused
        // there before anything else runs. Keeping both in one list is what `ast.d.mts` asks
        // for — a `BlueprintImport` is "a `using <Namespace> <version>;` line" — so the
        // constraint is checked here instead of being carried in the shape.
        if (imports[0].namespace !== 'Gtk') {
            throw this.fail(
                first,
                `found \`using ${imports[0].namespace}\`, expected \`using Gtk\` as the first directive`,
            );
        }

        if (this.at('translation-domain')) {
            // Out of scope because `BlueprintFile` holds imports and roots and nothing else. That
            // is the reason and it belongs here: the MESSAGE is read by someone who installed a
            // build plugin and has never seen this file.
            throw this.fail(
                this.peek(),
                'a file-level `translation-domain` is outside the subset this parser holds. The ' +
                    '`_("…")` markers still reach the XML as `translatable="yes"`; set the domain on the ' +
                    `builder instead of in the \`.blp\`, or drop the line where the app has one. ${SUBSET_NOTE}`,
            );
        }

        /** @type {TopLevel[]} */
        const roots = [];
        while (this.peek().type !== 'eof') {
            const token = this.peek();
            if (token.text === 'template') {
                roots.push(this.parseTemplate());
            } else if (token.text === 'menu') {
                roots.push(this.parseMenu());
            } else if (token.type === 'ident' || token.text === '$') {
                // `$` reaches `parseTypeRef` the same way an identifier does: an extern type
                // is an object like any other, and a root is one of the four places it sits.
                roots.push(this.parseObject());
            } else {
                throw this.fail(token, `found ${describe(token)}, expected a type name, \`template\` or \`menu\``);
            }
        }

        return { file: this.file, imports, roots };
    }

    /** @returns {BlueprintImport} */
    parseImport() {
        const keyword = this.expect('using', '`using`');
        const namespace = this.expectIdentifier('a GIR namespace');
        const version = this.peek();
        if (version.type !== 'number') {
            throw this.fail(version, `found ${describe(version)}, expected a version number`);
        }
        this.advance();
        this.expect(';', '`;`');
        // `version` keeps its SOURCE SPELLING for the same reason `NumberValue.raw` does:
        // `using Adw 1;` and `using Gtk 4.0;` are one number in JavaScript and two versions
        // to `gir.get_namespace`, and `4.0` parsed to `4` names no typelib.
        return { namespace: namespace.text, version: version.text, line: keyword.line };
    }

    /**
     * A type as the source spells it. The namespace KEY IS OMITTED for a bare `Box` rather
     * than set to `undefined`, because those are the same to `===` and different to
     * `assert.deepStrictEqual`, which compares own keys — an expectation written as
     * `{ name: 'Box', line: 3 }` would fail against `{ namespace: undefined, … }`. Every
     * optional field below is built the same way.
     *
     * Resolution is NOT done here: `ast.d.mts` § `TypeRef` records that an unqualified name
     * resolves against Gtk alone, and leaves applying that to whoever needs a GType.
     *
     * @returns {TypeRef}
     */
    parseTypeRef() {
        // `$Name` is an EXTERN type: a class the application registers itself, which no
        // `using` imports and no GIR describes. The sigil is the whole syntax — everything
        // after it is spelled like any other type — and `TypeRef.extern` carries it onward,
        // because the two exits have to treat the type differently and neither can tell from
        // the name (`$GtkBox` is legal and is NOT `GtkBox`).
        const extern = this.at('$') ? this.advance() : undefined;
        const first = this.expectIdentifier('a type name');
        const line = extern?.line ?? first.line;
        const sigil = extern === undefined ? {} : { extern: /** @type {true} */ (true) };
        if (!this.at('.')) {
            return { ...sigil, name: first.text, line };
        }
        this.advance();
        const name = this.expectIdentifier('a type name after `.`');
        return { ...sigil, namespace: first.text, name: name.text, line };
    }

    /** @returns {TemplateNode} */
    parseTemplate() {
        const keyword = this.expect('template', '`template`');
        if (!this.at('$')) {
            throw this.fail(
                this.peek(),
                `found ${describe(this.peek())}, expected \`$\` — a template class is written \`template $Name: Parent\` since blueprint 0.8.0`,
            );
        }
        this.advance();
        const className = this.expectIdentifier('a template class name');
        // The parent is Optional in the oracle's grammar, and its absence is a fact the tree
        // carries rather than one it repairs: `parent` is simply not set. What the absence
        // COSTS is in `TemplateNode.parent` — an extern template type validates nothing
        // written inside it.
        let parent;
        if (this.at(':')) {
            this.advance();
            parent = this.parseTypeRef();
        }
        return {
            kind: 'template',
            className: className.text,
            ...(parent === undefined ? {} : { parent }),
            body: this.parseObjectBody(),
            line: keyword.line,
        };
    }

    /** @returns {ObjectNode} */
    parseObject() {
        const type = this.parseTypeRef();
        // Anything that is still an identifier here is the object id: the oracle's `Object`
        // grammar is `ConcreteClassName Optional(id) ObjectContent` and nothing else fits.
        const id = this.peek().type === 'ident' ? this.advance().text : undefined;
        const body = this.parseObjectBody();
        return { kind: 'object', type, ...(id === undefined ? {} : { id }), body, line: type.line };
    }

    /** @returns {ObjectBody} */
    parseObjectBody() {
        const opening = this.expect('{', '`{`');
        /** @type {Property[]} */
        const properties = [];
        /** @type {Child[]} */
        const children = [];
        /** @type {Signal[]} */
        const signals = [];
        /** @type {Extension[]} */
        const extensions = [];

        // Stamped on every member as it is parsed. These four arrays are the only place
        // source order is destroyed, and this is the only place it can be recorded — a tie
        // broken by `line` is broken wrongly the moment two members share one.
        let order = 0;

        while (!this.at('}')) {
            const token = this.peek();
            if (token.type === 'eof') {
                // Reported AT the end of file — that is where parsing stopped — but naming
                // the brace that is still open. An unclosed `{` is the one error whose
                // position and whose cause are always on different lines, and a reader given
                // only "line 12: expected `}`" has to find the culprit by hand.
                throw this.fail(token, `found end of file, expected \`}\` closing the \`{\` on line ${opening.line}`);
            }
            if (token.text === '[') {
                children.push({ ...this.parseAnnotatedChild(), order: order++ });
                continue;
            }
            if (token.text === '$') {
                // An extern child, `$MyWidget { }`. It is decided on the sigil alone and
                // before the two-token discrimination below, because `$` is never the start
                // of a property, a signal or an extension — the handler form `$name()` only
                // ever appears to the RIGHT of a `=>`.
                children.push({ object: this.parseObject(), line: token.line, order: order++ });
                continue;
            }
            if (token.type !== 'ident') {
                throw this.fail(
                    token,
                    `found ${describe(token)}, expected a property, a signal, a child object or \`}\``,
                );
            }

            // The whole discrimination, in the oracle's own order: `Signal`, `Property`, the
            // extensions, then `Child`. It is a two-token decision everywhere — the keyword
            // alone never settles it, because `styles` is a legal object id and `condition`
            // a legal property name.
            const next = this.peek(1);
            if (next.text === ':') {
                properties.push({ ...this.parseProperty(), order: order++ });
            } else if (next.text === '::' || next.text === '=>') {
                signals.push({ ...this.parseSignal(), order: order++ });
            } else if (BLOCK_EXTENSIONS.has(token.text) && next.text === '{') {
                extensions.push({ ...this.parseBlockExtension(), order: order++ });
            } else if (token.text === 'condition' && next.text === '(') {
                extensions.push({ ...this.parseConditionExtension(), order: order++ });
            } else if (token.text === 'responses' && next.text === '[') {
                extensions.push({ ...this.parseResponsesExtension(), order: order++ });
            } else if (LIST_PROPERTIES.has(token.text) && next.text === '[') {
                properties.push({ ...this.parseListProperty(), order: order++ });
            } else if (REFUSED_EXTENSIONS.has(token.text) && (token.text === 'template' || next.text === '[')) {
                throw this.fail(
                    token,
                    `found ${REFUSED_EXTENSIONS.get(token.text)}, which is not in this subset — no corpus file reaches it, and \`Extension\` in ast.d.mts would record its name and drop its own vocabulary`,
                );
            } else {
                children.push({ object: this.parseObject(), line: token.line, order: order++ });
            }
        }
        this.expect('}', '`}`');
        return { properties, children, signals, extensions };
    }

    /**
     * `[start] Gtk.Button { }`.
     *
     * `Child.line` is the `[`, because `ast.d.mts` says a node's line is the line of the
     * token that STARTED it and the bracket is where this child starts. The object keeps its
     * own line, which is the one `corpus/expectations.mjs` names for a loss ("the object
     * line … never the bracket above it") — both are on the node, so neither exit re-scans.
     *
     * @returns {Child}
     */
    parseAnnotatedChild() {
        const bracket = this.expect('[', '`[`');
        const slot = this.expectIdentifier('a child slot name');
        if (slot.text === 'internal-child') {
            // `Child.slot` is the bracket TEXT alone, so it cannot tell `<child internal-child=…>`
            // from `<child type=…>` — which is why this is refused rather than emitted as the
            // wrong one of the two.
            throw this.fail(
                slot,
                'an `[internal-child …]` bracket is outside the subset this parser holds. A bracket ' +
                    'here becomes `<child type="…">`, a different element that GtkBuilder reads ' +
                    `differently, so it is refused rather than spelled as the wrong one. ${SUBSET_NOTE}`,
            );
        }
        if (slot.text === 'action' && this.at('response')) {
            throw this.fail(
                slot,
                'found `[action response=…]`; `Child` in ast.d.mts has no field for a response id, so the action-widget annotation is out of scope',
            );
        }
        this.expect(']', '`]`');
        return { slot: slot.text, object: this.parseObject(), line: bracket.line };
    }

    /** @returns {Property} */
    parseProperty() {
        const name = this.expectIdentifier('a property name');
        this.expect(':', '`:`');
        const value = this.parseValue({ allowObject: true, allowList: true });
        this.expect(';', '`;`');
        return { name: name.text, value, line: name.line };
    }

    /**
     * `styles [ "flat", "circular", ]`.
     *
     * No terminating `;`, and one is refused rather than tolerated: measured on 0.20.4,
     * `styles ["flat"];` is `error: Unexpected tokens` at the semicolon, because `ExtStyles`
     * is not wrapped in the `Statement` that gives a property its `;`.
     *
     * @returns {Property}
     */
    parseListProperty() {
        const name = this.advance();
        const value = this.parseListValue();
        if (this.at(';')) {
            throw this.fail(
                this.peek(),
                `found \`;\`, expected \`}\` or the next entry — \`${name.text} [ … ]\` takes no \`;\``,
            );
        }
        return { name: name.text, value, line: name.line };
    }

    /** @returns {Signal} */
    parseSignal() {
        const name = this.expectIdentifier('a signal name');
        let detail;
        if (this.at('::')) {
            this.advance();
            detail = this.expectIdentifier('a signal detail name').text;
        }
        this.expect('=>', '`=>`');
        if (!this.at('$')) {
            throw this.fail(
                this.peek(),
                `found ${describe(this.peek())}, expected \`$\` — a handler is written \`$name()\``,
            );
        }
        this.advance();
        const handler = this.expectIdentifier('the name of a function to handle the signal');
        this.expect('(', '`(`');
        const object = this.at(')') ? undefined : this.expectIdentifier('an object id').text;
        this.expect(')', '`)`');
        /** @type {string[]} */
        const flags = [];
        while (this.peek().type === 'ident' && SIGNAL_FLAGS.has(this.peek().text)) {
            flags.push(this.advance().text);
        }
        this.expect(';', '`;`');
        return {
            name: name.text,
            ...(detail === undefined ? {} : { detail }),
            handler: handler.text,
            ...(object === undefined ? {} : { object }),
            flags,
            line: name.line,
        };
    }

    /**
     * `layout { }`, `accessibility { }`, `setters { }`.
     *
     * @returns {Extension}
     */
    parseBlockExtension() {
        const keyword = this.advance();
        const opening = this.expect('{', '`{`');
        /** @type {ExtensionEntry[]} */
        const entries = [];
        while (!this.at('}')) {
            if (this.peek().type === 'eof') {
                throw this.fail(
                    this.peek(),
                    `found end of file, expected \`}\` closing the \`${keyword.text} {\` on line ${opening.line}`,
                );
            }
            entries.push(this.parseExtensionEntry(keyword.text));
        }
        this.expect('}', '`}`');
        return { name: keyword.text, entries, line: keyword.line };
    }

    /**
     * One `name: value;` line of a block extension.
     *
     * A `setters` entry addresses another object — `AdwBreakpointSetter` is
     * `IDENT "." IDENT ":" Value`, with the dot mandatory — and the two halves are joined
     * into `Property.name` as `binOne.visible`, because `Property` carries a name and a value
     * and nothing else. The emitter splits it again on the dot; `<setter object= property=>`
     * is the only thing the pair means.
     *
     * @param {string} block
     * @returns {ExtensionEntry}
     */
    parseExtensionEntry(block) {
        const first = this.expectIdentifier('a property name');
        let name = first.text;
        if (block === 'setters') {
            this.expect('.', '`.` — a setter is written `<object>.<property>: <value>;`');
            name += `.${this.expectIdentifier('a property name').text}`;
        } else if (this.at('.')) {
            throw this.fail(this.peek(), 'found `.`, expected `:` — only a `setters` block addresses another object');
        }
        this.expect(':', '`:`');
        // Only `accessibility` takes the list form (`labelled-by: [a, b];`); `layout` and
        // `setters` take a plain `Value` in the oracle's grammar and take one here.
        const value = this.parseValue({ allowObject: false, allowList: block === 'accessibility' });
        this.expect(';', '`;`');
        return { name, value, line: first.line };
    }

    /**
     * `condition ("max-width: 400px")`.
     *
     * `argument` is the RAW parenthesised slice, quotes included — `ast.d.mts` calls it "the
     * parenthesised text, undecoded", and keeping the source slice is lossless in the same
     * way `NumberValue.raw` is: from the slice an exit can recover the inner text, from the
     * inner text nothing can recover how it was written. The oracle requires the quotes
     * (`AdwBreakpointCondition` is `condition "(" UseQuoted ")"`, and `condition (max-width:
     * 400px)` is `error: Unexpected tokens` on 0.20.4), so the slice is always one string
     * token and never a bare expression.
     *
     * @returns {Extension}
     */
    parseConditionExtension() {
        const keyword = this.advance();
        this.expect('(', '`(`');
        const argument = this.peek();
        if (argument.type !== 'string') {
            throw this.fail(argument, `found ${describe(argument)}, expected a quoted condition`);
        }
        this.advance();
        this.expect(')', '`)`');
        return { name: keyword.text, argument: argument.text, entries: [], line: keyword.line };
    }

    /**
     * `responses [ cancel: _("Cancel"), ok: _("OK") ]`.
     *
     * Named by `ast.d.mts` § `Extension` and held by `31-responses.blp`. The response FLAGS
     * the oracle accepts (`suggested`, `destructive`, `disabled`) are refused rather than
     * dropped: `Extension.entries` is a list of `Property`, which has no field for them, and
     * an emitted `<response>` missing its `appearance` is exactly clause 3's "plausible and
     * means something else".
     *
     * @returns {Extension}
     */
    parseResponsesExtension() {
        const keyword = this.advance();
        this.expect('[', '`[`');
        /** @type {ExtensionEntry[]} */
        const entries = [];
        while (!this.at(']')) {
            const id = this.expectIdentifier('a response id');
            this.expect(':', '`:`');
            const value = this.parseValue({ allowObject: false, allowList: false });
            if (value.kind !== 'string') {
                throw this.fail(
                    id,
                    `found a ${value.kind} value for \`${id.text}\`, expected a string or a translated string`,
                );
            }
            if (this.peek().type === 'ident' && RESPONSE_FLAGS.has(this.peek().text)) {
                // `ExtensionEntry` carries a name, a value and a line, and has no field for a flag.
                throw this.fail(
                    this.peek(),
                    `a response flag (\`${this.peek().text}\`) is outside the subset this parser holds. ` +
                        'Declare the response without the flag and set its appearance or enabled state ' +
                        `from code on the dialog. ${SUBSET_NOTE}`,
                );
            }
            entries.push({ name: id.text, value, line: id.line });
            if (!this.at(',')) {
                break;
            }
            this.advance();
        }
        this.expect(']', '`]`');
        return { name: keyword.text, entries, line: keyword.line };
    }

    /**
     * `menu <id> { … }` — a root, and the only construct here that is not a widget.
     *
     * @returns {MenuNode}
     */
    parseMenu() {
        const keyword = this.expect('menu', '`menu`');
        const id = this.peek().type === 'ident' ? this.advance().text : undefined;
        const opening = this.expect('{', '`{`');
        /** @type {MenuItem[]} */
        const items = [];
        // The same counter `parseObjectBody` keeps, for the same reason: a menu body has two
        // arrays too, and `26-one-line-members.blp` writes an item and an attribute on one line.
        let order = 0;
        while (!this.at('}')) {
            if (this.peek().type === 'eof') {
                throw this.fail(
                    this.peek(),
                    `found end of file, expected \`}\` closing the \`menu {\` on line ${opening.line}`,
                );
            }
            items.push({ ...this.parseMenuItem(), order: order++ });
        }
        this.expect('}', '`}`');
        return { kind: 'menu', ...(id === undefined ? {} : { id }), items, line: keyword.line };
    }

    /** @returns {MenuItem} */
    parseMenuItem() {
        const keyword = this.peek();
        if (keyword.type !== 'ident' || !MENU_ITEM_KEYWORDS.has(keyword.text)) {
            throw this.fail(keyword, `found ${describe(keyword)}, expected \`section\`, \`submenu\` or \`item\``);
        }
        this.advance();
        const kind = /** @type {MenuItem['kind']} */ (keyword.text);

        if (kind === 'item' && this.at('(')) {
            return this.parseMenuItemShorthand(keyword);
        }
        // `section`/`submenu` take an optional id in the oracle and it is refused here:
        // `MenuItem` in ast.d.mts has a kind, attributes, items and a line, and dropping an
        // id the source wrote is the pass-through clause 3 forbids.
        if (this.peek().type === 'ident') {
            throw this.fail(
                this.peek(),
                `found the id \`${this.peek().text}\`; \`MenuItem\` in ast.d.mts has no \`id\` field, so a named \`${kind}\` is out of scope`,
            );
        }

        const opening = this.expect('{', '`{`');
        /** @type {MenuAttribute[]} */
        const attributes = [];
        /** @type {MenuItem[]} */
        const items = [];
        let order = 0;
        while (!this.at('}')) {
            const token = this.peek();
            if (token.type === 'eof') {
                throw this.fail(
                    token,
                    `found end of file, expected \`}\` closing the \`${kind} {\` on line ${opening.line}`,
                );
            }
            if (token.type === 'ident' && MENU_ITEM_KEYWORDS.has(token.text)) {
                if (kind === 'item') {
                    throw this.fail(
                        token,
                        `found ${describe(token)}, expected an attribute — an \`item\` holds attributes only`,
                    );
                }
                items.push({ ...this.parseMenuItem(), order: order++ });
                continue;
            }
            attributes.push({ ...this.parseMenuAttribute(), order: order++ });
        }
        this.expect('}', '`}`');
        return { kind, attributes, items, line: keyword.line };
    }

    /**
     * `item ("Deep", "app.deep")` — sugar for the long form, and nothing more.
     *
     * The golden for `22-menu-nested.blp` marks exactly the `_()`-marked one of two shorthand
     * items, so `translatable` follows the MARKING and never the form. That falls out here
     * because both forms build their attribute from the same `parseValue`.
     *
     * @param {Token} keyword
     * @returns {MenuItem}
     */
    parseMenuItemShorthand(keyword) {
        this.expect('(', '`(`');
        /** @type {MenuAttribute[]} */
        const attributes = [];
        for (const name of ['label', 'action', 'icon']) {
            if (this.at(')')) {
                break;
            }
            const start = this.peek();
            const value = this.parseValue({ allowObject: false, allowList: false });
            if (value.kind !== 'string') {
                throw this.fail(start, `found a ${value.kind} value, expected a string or a translated string`);
            }
            attributes.push({ name, value, line: start.line, order: attributes.length });
            if (!this.at(',')) {
                break;
            }
            this.advance();
        }
        this.expect(')', '`)`');
        return { kind: 'item', attributes, items: [], line: keyword.line };
    }

    /** One `name: "value";` line inside a menu item. @returns {MenuAttribute} */
    parseMenuAttribute() {
        const name = this.expectIdentifier('an attribute name');
        this.expect(':', '`:`');
        const value = this.parseValue({ allowObject: false, allowList: false });
        if (value.kind !== 'string') {
            throw this.fail(
                name,
                `found a ${value.kind} value for \`${name.text}\`, expected a string or a translated string`,
            );
        }
        this.expect(';', '`;`');
        return { name: name.text, value, line: name.line };
    }

    /**
     * The NUMBER pattern admits `0xZZ` and the oracle's `get_number` refuses it; the same question
     * is asked here, at the same point, so no exit meets a literal it cannot read. The catch exists
     * to relocate the sentence: `numberLiteral` knows the spelling and this class knows the line.
     *
     * @param {string} raw @param {Token} at
     * @returns {Value}
     */
    numberValue(raw, at) {
        try {
            numberLiteral(raw);
        } catch (error) {
            throw this.fail(at, error.message);
        }
        return { kind: 'number', raw, line: at.line };
    }

    /**
     * @param {{ allowObject: boolean, allowList: boolean }} options
     * @returns {Value}
     */
    parseValue(options) {
        const token = this.peek();

        if (token.type === 'string') {
            this.advance();
            return { kind: 'string', value: token.value, line: token.line };
        }
        if (token.type === 'number') {
            this.advance();
            return this.numberValue(token.text, token);
        }
        // The oracle's `NumberLiteral` is `Optional(sign) NUMBER` and its tokenizer has no
        // signed NUMBER pattern, so `-1` is two tokens there and here. The sign is glued back
        // onto `raw` because `raw` is the SOURCE SPELLING and `1` is not what the file says.
        if (token.text === '-' || token.text === '+') {
            const number = this.peek(1);
            if (number.type !== 'number') {
                throw this.fail(number, `found ${describe(number)}, expected a number after \`${token.text}\``);
            }
            this.advance();
            this.advance();
            return this.numberValue(token.text + number.text, token);
        }

        if (token.text === '[') {
            if (!options.allowList) {
                throw this.fail(token, 'found `[`, expected a value — a list is not permitted here');
            }
            return this.parseListValue();
        }

        // An extern object as a property VALUE — `content: $MyWidget { }`. Decided before the
        // `ident` gate below, because `$` is an operator token and would otherwise never reach
        // the object branch at the foot of this function.
        if (token.text === '$') {
            const name = this.peek(1);
            // `$name(…)` is a CLOSURE, not a type. The oracle refuses one here too — it admits
            // closures only inside `bind` and `expr` — and without this the object branch would
            // refuse it by complaining about a missing `{`, which names a brace where the
            // construct is the thing a reader has to remove.
            if (name.type === 'ident' && this.at('(', 2)) {
                throw this.fail(
                    token,
                    `found the closure \`$${name.text}(…)\` as a plain value; \`Value\` in ast.d.mts has no closure member, and the oracle admits one only inside \`bind\` or \`expr\` ("Expected property value")`,
                );
            }
            if (!options.allowObject) {
                throw this.fail(token, 'found an object, expected a scalar value — an object is not permitted here');
            }
            return { kind: 'object', object: this.parseObject(), line: token.line };
        }

        if (token.type !== 'ident') {
            throw this.fail(token, `found ${describe(token)}, expected a value`);
        }

        if ((token.text === '_' || token.text === 'C_') && this.at('(', 1)) {
            return this.parseTranslatedValue();
        }
        // `true`/`false` are ordinary identifiers to the oracle, resolved against the
        // ParamSpec's type. `ast.d.mts` declares a `BoolValue`, so the two names are the one
        // identifier this parser decides without a typelib — and the only one, which is why
        // `vertical` stays an `IdentValue` two lines down.
        if (token.text === 'true' || token.text === 'false') {
            this.advance();
            return { kind: 'bool', value: token.text === 'true', line: token.line };
        }
        if (token.text === 'bind' || token.text === 'expr') {
            return this.parseBinding();
        }
        if (token.text === 'bind-property') {
            throw this.fail(token, 'found `bind-property`, expected `bind` — the old spelling is not in this subset');
        }
        if (token.text === 'typeof' && this.at('<', 1)) {
            const keyword = this.advance();
            return { kind: 'type', type: this.parseAngleType(), line: keyword.line };
        }
        if (token.text === 'menu' && (this.at('{', 1) || (this.peek(1).type === 'ident' && this.at('{', 2)))) {
            // Legal in the oracle (`menu-model: menu { … };` compiles to a nested `<menu>`),
            // and refused here: `Property.value` is a `Value`, and `Value` has no menu member.
            // This refusal is the whole reason `Child.object` is an `ObjectNode` and not a
            // union with `MenuNode` — no menu can reach a child, so the arm was a branch three
            // readers had to write and none could take. `ast.d.mts` § `Child` records that.
            throw this.fail(
                token,
                'an inline `menu` as a property value is outside the subset this parser holds. Declare ' +
                    'the menu at the top level, give it an id, and point the property at it: ' +
                    `\`menu myMenu { … }\` beside the object, then \`menu-model: myMenu\`. ${SUBSET_NOTE}`,
            );
        }

        const isObjectStart = this.at('.', 1) || this.at('{', 1) || (this.peek(1).type === 'ident' && this.at('{', 2));
        if (isObjectStart) {
            if (!options.allowObject) {
                throw this.fail(token, 'found an object, expected a scalar value — an object is not permitted here');
            }
            return { kind: 'object', object: this.parseObject(), line: token.line };
        }

        // An enum member, an object id or a flag set — `ast.d.mts` § `IdentValue` names all
        // three and refuses to guess between them. A flag set keeps its source spelling
        // joined by `|` in the one `name`, because that is the only field the shape has.
        this.advance();
        let name = token.text;
        while (this.at('|')) {
            this.advance();
            name += `|${this.expectIdentifier('a flag name').text}`;
        }
        return { kind: 'ident', name, line: token.line };
    }

    /** `_("x")` and `C_("ctx", "x")`. @returns {StringValue} */
    parseTranslatedValue() {
        const marker = this.advance();
        this.expect('(', '`(`');
        const first = this.peek();
        if (first.type !== 'string') {
            throw this.fail(first, `found ${describe(first)}, expected a quoted string`);
        }
        this.advance();
        if (marker.text === '_') {
            this.expect(')', '`)`');
            return { kind: 'string', value: first.value, translatable: {}, line: marker.line };
        }
        this.expect(',', '`,` — `C_()` takes a context and a string');
        const string = this.peek();
        if (string.type !== 'string') {
            throw this.fail(string, `found ${describe(string)}, expected a quoted string`);
        }
        this.advance();
        this.expect(')', '`)`');
        return { kind: 'string', value: string.value, translatable: { context: first.value }, line: marker.line };
    }

    /**
     * `bind <expression> [flags…]` and `expr <expression>`.
     *
     * One function for both keywords: the grammar after them is identical, and only `bind`
     * takes flags — measured, `expr f1.expression bidirectional` is `Expected \`;\`` on
     * 0.20.4, so the flag loop runs for `bind` alone and a flag word after `expr` falls
     * through to the property's own `;`.
     *
     * @returns {BindingValue}
     */
    parseBinding() {
        const keyword = this.advance();
        const form = /** @type {'bind' | 'expr'} */ (keyword.text);
        const expression = this.parseExpression();

        /** @type {string[]} */
        const flags = [];
        if (form === 'bind') {
            while (this.peek().type === 'ident' && BINDING_FLAGS.has(this.peek().text)) {
                flags.push(this.advance().text);
            }
        }
        // In SOURCE ORDER, and only what the source wrote. The compiler adds
        // `bind-flags="sync-create"` of its own — but not unconditionally, as the note on
        // `13-binding.blp` in `corpus/manifest.mjs` records, so the default belongs to the
        // emitter and never to the parse.
        return { kind: 'binding', form, expression, flags, line: keyword.line };
    }

    /**
     * An expression: a chain of `.property` lookups and `as <Type>` casts over one operand.
     *
     * The two postfix operators are read in ONE loop because the source may alternate them
     * freely — `label.parent as <Overlay>.child as <Label>.label` is lookup, cast, lookup,
     * cast, lookup — and each one wraps what came before it. Nothing here binds tighter than
     * anything else; there is no precedence to get wrong, only order.
     *
     * @returns {Expression}
     */
    parseExpression() {
        let expression = this.parseOperand();
        for (;;) {
            if (this.at('.')) {
                const dot = this.advance();
                const name = this.expectIdentifier('a property name after `.`');
                expression = { kind: 'lookup', name: name.text, of: expression, line: dot.line };
                continue;
            }
            if (this.peek().type === 'ident' && this.peek().text === 'as') {
                const as = this.advance();
                const type = this.parseAngleType();
                // A Blueprint BUILT-IN is an unqualified, sigil-free name in a closed list —
                // `src/builtin-types.mjs` argues why that list is checked in rather than
                // derived. The order matters and is the oracle's: `as <string>` is
                // `gchararray` and never a search for a type called `Gtk.string`.
                const builtin =
                    type.extern !== true && type.namespace === undefined && BUILTIN_GTYPES.has(type.name)
                        ? type.name
                        : undefined;
                expression =
                    builtin === undefined
                        ? { kind: 'cast', of: expression, type, line: as.line }
                        : { kind: 'cast', of: expression, builtin, line: as.line };
                continue;
            }
            return expression;
        }
    }

    /** `< Type >` — the argument of a cast or of `typeof`. @returns {TypeRef} */
    parseAngleType() {
        this.expect('<', '`<` — a type argument is written `<Type>`');
        const type = this.parseTypeRef();
        this.expect('>', '`>` — a type argument is written `<Type>`');
        return type;
    }

    /**
     * What an expression is built on: an identifier, `item`, a closure call, a literal, a
     * parenthesised expression, `typeof<…>` or `try { … }`.
     *
     * @returns {Expression}
     */
    parseOperand() {
        const token = this.peek();

        if (token.text === '(') {
            this.advance();
            const inner = this.parseExpression();
            this.expect(')', '`)` — a parenthesised expression');
            // The brackets are KEPT. `bind l.name` and `bind (l.name)` are two different
            // outputs on 0.20.4 — see the note on `Expression` in ast.d.mts — so dropping
            // them here would be the silent wrong answer clause 3 refuses.
            return { kind: 'paren', of: inner, line: token.line };
        }

        if (token.text === '$') {
            this.advance();
            const name = this.expectIdentifier('a closure name after `$`');
            this.expect('(', '`(` — a closure is written `$name(…)`');
            /** @type {Expression[]} */
            const args = [];
            while (!this.at(')')) {
                args.push(this.parseExpression());
                if (!this.at(',')) break;
                this.advance();
            }
            this.expect(')', '`)` — the end of a closure argument list');
            return { kind: 'closure', name: name.text, args, line: token.line };
        }

        if (token.type === 'string') {
            this.advance();
            return {
                kind: 'literal',
                value: { kind: 'string', value: token.value, line: token.line },
                line: token.line,
            };
        }
        if (token.type === 'number') {
            this.advance();
            return { kind: 'literal', value: this.numberValue(token.text, token), line: token.line };
        }
        if (token.text === '-' || token.text === '+') {
            const number = this.peek(1);
            if (number.type !== 'number') {
                throw this.fail(number, `found ${describe(number)}, expected a number after \`${token.text}\``);
            }
            this.advance();
            this.advance();
            return { kind: 'literal', value: this.numberValue(token.text + number.text, token), line: token.line };
        }

        if (token.type !== 'ident') {
            throw this.fail(token, `found ${describe(token)}, expected an expression`);
        }

        if ((token.text === '_' || token.text === 'C_') && this.at('(', 1)) {
            const string = this.parseTranslatedValue();
            return { kind: 'literal', value: string, line: string.line };
        }
        if (token.text === 'true' || token.text === 'false') {
            this.advance();
            return {
                kind: 'literal',
                value: { kind: 'bool', value: token.text === 'true', line: token.line },
                line: token.line,
            };
        }
        if (token.text === 'item') {
            this.advance();
            return { kind: 'item', line: token.line };
        }
        if (token.text === 'typeof' && this.at('<', 1)) {
            this.advance();
            return { kind: 'type', type: this.parseAngleType(), line: token.line };
        }
        if (token.text === 'try' && this.at('{', 1)) {
            this.advance();
            this.advance();
            /** @type {Expression[]} */
            const arms = [];
            while (!this.at('}')) {
                arms.push(this.parseExpression());
                if (!this.at(',')) break;
                this.advance();
            }
            this.expect('}', '`}` — the end of a `try { … }`');
            return { kind: 'try', arms, line: token.line };
        }

        this.advance();
        return { kind: 'ident', name: token.text, line: token.line };
    }

    /**
     * `[ "flat", "circular", ]` — trailing comma optional, both forms in the corpus.
     *
     * Items are scalars only. The oracle's `ArrayValue` is `Delimited(Value, ",")` and its
     * `Value` is `AnyOf(Translated, Flags, Literal)` with no object member, so accepting an
     * object here would accept what the oracle rejects.
     *
     * @returns {ListValue}
     */
    parseListValue() {
        const bracket = this.expect('[', '`[`');
        /** @type {Value[]} */
        const items = [];
        while (!this.at(']')) {
            if (this.peek().type === 'eof') {
                throw this.fail(
                    this.peek(),
                    `found end of file, expected \`]\` closing the \`[\` on line ${bracket.line}`,
                );
            }
            items.push(this.parseValue({ allowObject: false, allowList: false }));
            if (!this.at(',')) {
                break;
            }
            this.advance();
        }
        this.expect(']', '`]`');
        return { kind: 'list', items, line: bracket.line };
    }
}

/**
 * Parse a `.blp` source into the AST `ast.d.mts` declares.
 *
 * @param {string} source  the `.blp` text
 * @param {string} file    the path this source came from — nothing here reads the filesystem, but
 *                         it travels on the returned `BlueprintFile` so the two exits after this
 *                         one can name it without being told a second time
 * @returns {BlueprintFile}
 * @throws {BlueprintSyntaxError} on any construct outside the subset, naming its line
 */
export function parseBlueprint(source, file) {
    return new Parser(tokenize(source, file), file).parseFile();
}
