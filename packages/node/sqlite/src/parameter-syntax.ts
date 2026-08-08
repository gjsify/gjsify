// SQLite parameter syntax (?, ?NNN, $name, :name, @name) → Gda's ##name::type syntax.
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

/** One placeholder found in the SQL. `position` is -1 for named parameters. */
export interface ParamInfo {
    gdaId: string;
    originalName: string;
    position: number;
}

/**
 * Decides what a placeholder becomes in the SQL handed to libgda.
 *
 * `StatementSync` substitutes this per execution, because the choice depends on the value:
 * a string becomes a `##id::string` holder so its text never enters the SQL, everything
 * else becomes a literal drawn from an alphabet that cannot end a quoted region. Callers
 * that only need to VALIDATE the SQL, where no values exist yet, take the default.
 */
export type PlaceholderRenderer = (param: ParamInfo) => string;

export const asStringHolder: PlaceholderRenderer = (param) => `##${param.gdaId}::string`;

/**
 * Rewrite `sql` with every parameter rendered by `render`, and report the parameters in
 * source order. String literals are copied verbatim so a `?` or `:name` inside one is not
 * mistaken for a placeholder.
 */
export function convertParameterSyntax(
    sql: string,
    render: PlaceholderRenderer = asStringHolder,
): [string, ParamInfo[]] {
    const params: ParamInfo[] = [];
    let positionalIndex = 0;
    let result = '';
    let i = 0;

    while (i < sql.length) {
        // Skip string literals
        if (sql[i] === "'") {
            const start = i;
            i++;
            while (i < sql.length && sql[i] !== "'") {
                if (sql[i] === "'" && sql[i + 1] === "'") {
                    i += 2;
                    continue;
                }
                i++;
            }
            if (i < sql.length) i++; // closing quote
            result += sql.substring(start, i);
            continue;
        }

        // Positional parameter: ? or ?NNN
        if (sql[i] === '?') {
            i++;
            let numStr = '';
            while (i < sql.length && sql[i] >= '0' && sql[i] <= '9') {
                numStr += sql[i];
                i++;
            }
            const pos = numStr ? parseInt(numStr, 10) - 1 : positionalIndex;
            positionalIndex = numStr ? positionalIndex : positionalIndex + 1;
            const param: ParamInfo = {
                gdaId: `p${pos}`,
                originalName: numStr ? `?${numStr}` : '?',
                position: pos,
            };
            params.push(param);
            result += render(param);
            continue;
        }

        // Named parameter: $name, :name, @name
        if (
            (sql[i] === '$' || sql[i] === ':' || sql[i] === '@') &&
            i + 1 < sql.length &&
            /[a-zA-Z_]/.test(sql[i + 1])
        ) {
            const prefix = sql[i];
            i++;
            let name = '';
            while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
                name += sql[i];
                i++;
            }
            const param: ParamInfo = { gdaId: name, originalName: `${prefix}${name}`, position: -1 };
            params.push(param);
            result += render(param);
            continue;
        }

        result += sql[i];
        i++;
    }

    return [result, params];
}
