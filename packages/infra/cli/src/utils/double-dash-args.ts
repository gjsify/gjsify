// The argv a caller wrote after `--`, read back off yargs.
//
// THE INCIDENT (#1531). `foreach.ts` and `run.ts` each read `args['--']` and
// narrowed it with `.filter((v): v is string => typeof v === 'string')`. That
// reads like a type narrowing and is a DELETION: yargs types a bare number in
// its `populate--` array as a `number`, so the value disappears and the option
// in front of it swallows the next flag. Measured against this repo's own
// yargs 18.0.0:
//
//   in    : gjsify publish --verify-timeout 5 --tag latest
//   raw   : ["gjsify","publish","--verify-timeout",5,"--tag","latest"]
//   filter: ["gjsify","publish","--verify-timeout","--tag","latest"]
//
// That argv shipped: `npm:publish` passes `--verify-timeout 5 --tag latest`,
// and release run 33804937881 echoed `--verify-timeout --tag latest` 209 times
// — `--verify-timeout` taking `--tag` as its value, `latest` a stray
// positional, `--tag latest` gone. Nobody noticed because npm's default
// dist-tag IS `latest`, which is luck rather than design.
//
// TWO HALVES, AND THE FIRST ONE IS THE FIX. A coercion here (`String(v)`) would
// recover the value and still lose its SPELLING — measured against yargs 18.0.0,
// `1.0` comes back as 1, `0.10` as 0.1, `0x10` as 16 and `1e3` as 1000, and an
// argv is text, not arithmetic. (A leading zero is NOT in that set: `007` stays
// the string yargs was given. It reads like the obvious example and is the one
// shape here that never broke.) So the parse is corrected at
// the source: every command that sets `populate--` also sets
// `parse-positional-numbers: false`, which leaves `_`, the variadic positionals
// and the `--` tail as the strings the user typed while option values declared
// `type: 'number'` are still parsed (measured: `--jobs 4` stays `4` the number).
//
// This function is the second half. It does NOT coerce — with the parser
// configured as above a non-string cannot arrive, so one that does means the
// configuration was dropped, and that is the failure to name rather than to
// paper over. A silent `.filter()` over a parser-produced array is the wrong
// tool wherever the array is data rather than a union.
//
// ONE reader for all of it, because there were three and they disagreed:
// `foreach.ts` (twice) and `run.ts` filtered, `dlx.ts` coerced. The drifted
// copies are the ones that shipped the wrong argv.

/**
 * Everything after the `--` separator, as an argv.
 *
 * @param args a yargs-parsed argument object from a command whose builder sets
 *   `parserConfiguration({ 'populate--': true, 'parse-positional-numbers': false })`
 * @throws if an entry is not a string, i.e. if that configuration is missing
 */
export function doubleDashArgs(args: object): string[] {
    const raw = (args as Record<string, unknown>)['--'];
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
        throw new Error(
            `gjsify: internal error — yargs' \`--\` slot holds a ${typeof raw} rather than an array, so the ` +
                'arguments after `--` cannot be forwarded. The command builder must set ' +
                "`parserConfiguration({ 'populate--': true })`.",
        );
    }
    return raw.map((value, index) => {
        if (typeof value === 'string') return value;
        throw new Error(
            `gjsify: internal error — the argument after \`--\` at position ${index} arrived as a ` +
                `${typeof value} (${String(value)}) instead of a string, so forwarding it would change what ` +
                'the caller wrote. The command builder must set ' +
                "`parserConfiguration({ 'parse-positional-numbers': false })` alongside `populate--`.",
        );
    });
}
