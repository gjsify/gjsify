// What this package throws, and the whole of it.
//
// WHY BOTH CLASSES LIVE HERE AND NOT BESIDE THE CODE THAT THROWS THEM
//
// ADR 0053 clause 3 makes the REFUSAL part of the contract: an unrecognised construct is a hard
// error naming its line, never a silent pass-through. There are two exits that can refuse —
// `parser.mjs` before an AST exists, `emit-xml.mjs` and `resolve-ident.mjs` after one does — and
// the consumer catching them is the same consumer. A class per exit file would have put the
// second one where the first could not import it (`resolve-ident.mjs` must not depend on
// `emit-xml.mjs`; the seams go the other way), which is how the emit half spent its whole life
// throwing a bare `Error`: there was no module both halves could reach.
//
// WHY A CLASS AND NOT A MESSAGE FORMAT
//
// `blueprint: line 8: …` is a format, and a consumer that wants the line out of it has to regex
// the message — which ties the build's diagnostics to the exact wording of a sentence written to
// be read, not parsed. Both classes carry the location as FIELDS, so a caller reads `.file` and
// `.line` and prints whatever it likes.
//
// WHY THE EMIT HALF HAS NO COLUMN
//
// `BlueprintSyntaxError` is thrown from a token and a token has one. The emit half is thrown from
// an AST node, and `ast.d.mts` gives every node a `line` and no column — so a column here would
// be invented, and an invented column points a reader at a place nothing measured. If the AST
// ever carries one, this class takes it the same way the other one does.

/**
 * What the parser throws, and the only thing it throws.
 *
 * The location is repeated in `message` as well as carried in the fields: a caller that only
 * prints the error still gets the line clause 3 asks it to name.
 */
export class BlueprintSyntaxError extends Error {
    /**
     * @param {string} message  what was found and what was expected
     * @param {string} file     path, for the message only — nothing here reads it
     * @param {number} line     1-based
     * @param {number} column   1-based
     */
    constructor(message, file, line, column) {
        super(`${file}:${line}:${column}: ${message}`);
        this.name = 'BlueprintSyntaxError';
        this.file = file;
        this.line = line;
        this.column = column;
    }
}

/**
 * What the two exits AFTER the parse throw: the XML emitter and the `@girs` resolver behind it.
 *
 * Same contract as `BlueprintSyntaxError` one stage earlier — the construct by name, the file and
 * the line — and the same reason: this is the error a build puts in front of someone whose `.blp`
 * uses a construct the subset does not hold, and "line 8" with no file names nothing in a project
 * with twelve of them.
 *
 * @param {string} message  the construct, by name, and why it is refused
 * @param {import('./ast.d.mts').SourceLocation} where  the file and line the construct sits on
 */
export class BlueprintEmitError extends Error {
    /** @param {string} message @param {import('./ast.d.mts').SourceLocation} where */
    constructor(message, where) {
        super(`${where.file}:${where.line}: ${message}`);
        this.name = 'BlueprintEmitError';
        this.file = where.file;
        this.line = where.line;
    }
}
