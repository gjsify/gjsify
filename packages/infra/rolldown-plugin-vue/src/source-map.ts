// Joining the source maps `@vue/compiler-sfc` hands back, because the module this
// plugin emits is a CONCATENATION and neither half's map describes it.
//
// `compileScript` maps the script half, `compileTemplate` maps the template half, and
// both already resolve to the WHOLE `.vue` file: measured on 3.5.41, `sourcesContent[0]`
// is the SFC source in both, and the template map's source lines already count from the
// top of the file rather than from the template block. So the source side needs nothing;
// only the GENERATED side does — where each half landed in the joined module.
//
// WHY DECODE AT ALL, rather than concatenate the two `mappings` strings with the right
// number of `;`. The generated COLUMN resets on every line, but the source index, source
// line, source column and name index are deltas carried across the entire map. Splice
// two strings together and the second half's first segment is read relative to the first
// half's last one, which puts every remaining mapping somewhere else in the file. The
// Base64-VLQ codec below is what makes offsetting possible; it is spelled out rather than
// taken as a dependency because `@jridgewell/sourcemap-codec` is only in this tree
// transitively, and a direct dependency of a tier-1 package costs a lockfile change and a
// "does it load under GJS" answer for thirty lines.

/** Base64 digits in `sourceMappingURL` order — index IS the value. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** One mapping with ABSOLUTE positions, which the wire form does not carry. */
interface Mapping {
    generatedColumn: number;
    /** Absent for a segment that marks generated code no source produced. */
    source?: number;
    sourceLine?: number;
    sourceColumn?: number;
    name?: number;
}

/**
 * The fields of a source map this merge READS.
 *
 * Deliberately not `source-map-js`'s `RawSourceMap`: that interface types `version` as
 * `string` while every producer writes the number 3, so accepting it would force a cast
 * at the one call site that has a real map.
 */
export interface SourceMapChunkMap {
    sources: string[];
    sourcesContent?: string[];
    names: string[];
    mappings: string;
}

/** What this module produces — assignable to rolldown's `ExistingRawSourceMap`. */
export interface CombinedSourceMap {
    version: 3;
    sources: string[];
    sourcesContent: (string | null)[];
    names: string[];
    mappings: string;
}

/** One piece of the joined module: how many lines it occupies, and its own map. */
export interface SourceMapChunk {
    /** Lines this piece occupies in the joined output, including its last. */
    lineCount: number;
    /** `null` for a piece this plugin generated, which no source position explains. */
    map: SourceMapChunkMap | null;
}

/** Signed Base64 VLQ: continuation in bit 5, sign in bit 0 of the first digit. */
function decodeVlq(segment: string, mappings: string): number[] {
    const values: number[] = [];
    let value = 0;
    let scale = 1;
    for (const char of segment) {
        const digit = BASE64.indexOf(char);
        if (digit === -1) throw new Error(malformed(mappings, `${JSON.stringify(char)} is not a Base64 VLQ digit`));
        // Multiplication rather than `<<`: a name index in a large map can exceed the
        // 31 bits a shift keeps, and the overflow would be silent.
        value += (digit & 31) * scale;
        if ((digit & 32) !== 0) {
            scale *= 32;
            continue;
        }
        values.push(value % 2 === 1 ? -(value - 1) / 2 : value / 2);
        value = 0;
        scale = 1;
    }
    if (scale !== 1) throw new Error(malformed(mappings, 'a VLQ value ends mid-continuation'));
    return values;
}

function encodeVlq(value: number): string {
    let rest = value < 0 ? -value * 2 + 1 : value * 2;
    let encoded = '';
    do {
        const digit = rest % 32;
        rest = Math.floor(rest / 32);
        encoded += BASE64[rest > 0 ? digit + 32 : digit];
    } while (rest > 0);
    return encoded;
}

function malformed(mappings: string, why: string): string {
    return (
        `@gjsify/rolldown-plugin-vue: cannot read a source map @vue/compiler-sfc produced — ${why}. ` +
        `Mappings began ${JSON.stringify(mappings.slice(0, 40))}.`
    );
}

/** The wire form, line by line, with every position made absolute. */
function decodeMappings(mappings: string): Mapping[][] {
    let source = 0;
    let sourceLine = 0;
    let sourceColumn = 0;
    let name = 0;
    return mappings.split(';').map((line) => {
        let generatedColumn = 0;
        return line
            .split(',')
            .filter((segment) => segment !== '')
            .map((segment) => {
                const fields = decodeVlq(segment, mappings);
                generatedColumn += fields[0] as number;
                if (fields.length === 1) return { generatedColumn };
                // 2 and 3 are not shapes the format has. Refused rather than read as a
                // 4-field segment with zeros, which would point at line 1 column 1.
                if (fields.length < 4) {
                    throw new Error(malformed(mappings, `a segment carries ${fields.length} fields, not 1, 4 or 5`));
                }
                source += fields[1] as number;
                sourceLine += fields[2] as number;
                sourceColumn += fields[3] as number;
                const mapping: Mapping = { generatedColumn, source, sourceLine, sourceColumn };
                if (fields.length > 4) {
                    name += fields[4] as number;
                    mapping.name = name;
                }
                return mapping;
            });
    });
}

function encodeMappings(lines: readonly Mapping[][]): string {
    let source = 0;
    let sourceLine = 0;
    let sourceColumn = 0;
    let name = 0;
    return lines
        .map((segments) => {
            let generatedColumn = 0;
            return segments
                .map((mapping) => {
                    let encoded = encodeVlq(mapping.generatedColumn - generatedColumn);
                    generatedColumn = mapping.generatedColumn;
                    if (mapping.source === undefined) return encoded;
                    encoded +=
                        encodeVlq(mapping.source - source) +
                        encodeVlq((mapping.sourceLine as number) - sourceLine) +
                        encodeVlq((mapping.sourceColumn as number) - sourceColumn);
                    source = mapping.source;
                    sourceLine = mapping.sourceLine as number;
                    sourceColumn = mapping.sourceColumn as number;
                    if (mapping.name !== undefined) {
                        encoded += encodeVlq(mapping.name - name);
                        name = mapping.name;
                    }
                    return encoded;
                })
                .join(',');
        })
        .join(';');
}

/**
 * One map for a module built by joining `chunks` with a newline between each.
 *
 * `null` when no chunk carried a map, so a caller can pass `map: null` — which tells a
 * bundler "this code has no source", not "this code is its own source".
 */
export function combineSourceMaps(chunks: readonly SourceMapChunk[]): CombinedSourceMap | null {
    if (!chunks.some((chunk) => chunk.map !== null)) return null;

    const sources: string[] = [];
    const sourcesContent: (string | null)[] = [];
    const names: string[] = [];
    const lines: Mapping[][] = [];

    for (const chunk of chunks) {
        if (chunk.map === null) {
            lines.push(...Array.from({ length: chunk.lineCount }, () => []));
            continue;
        }
        const decoded = decodeMappings(chunk.map.mappings);
        // A map describing MORE lines than its chunk holds would shift every following
        // chunk, and silently: the mappings still decode, they just point into the wrong
        // half of the module. That is the whole failure this function exists to avoid.
        if (decoded.length > chunk.lineCount) {
            throw new Error(
                `@gjsify/rolldown-plugin-vue: a source map describes ${decoded.length} line(s) for a ` +
                    `${chunk.lineCount}-line chunk. Every mapping after it would name the wrong line.`,
            );
        }
        // Source and name indices are per-map; the merged map has one table for all.
        const sourceIndex = chunk.map.sources.map((source, index) => {
            const existing = sources.indexOf(source);
            if (existing !== -1) return existing;
            sources.push(source);
            sourcesContent.push(chunk.map?.sourcesContent?.[index] ?? null);
            return sources.length - 1;
        });
        const nameIndex = chunk.map.names.map((entry) => {
            const existing = names.indexOf(entry);
            if (existing !== -1) return existing;
            names.push(entry);
            return names.length - 1;
        });

        for (const segments of decoded) {
            lines.push(
                segments.map((mapping) =>
                    mapping.source === undefined
                        ? mapping
                        : {
                              ...mapping,
                              source: sourceIndex[mapping.source] as number,
                              ...(mapping.name === undefined ? {} : { name: nameIndex[mapping.name] as number }),
                          },
                ),
            );
        }
        for (let line = decoded.length; line < chunk.lineCount; line++) lines.push([]);
    }

    return { version: 3, sources, sourcesContent, names, mappings: encodeMappings(lines) };
}

/**
 * Where `generatedLine`/`generatedColumn` (both 1-based) came from, or `null`.
 *
 * Exported for the specs: a merged map is only checkable by resolving a position
 * through it, and asserting the `mappings` STRING would pin the encoder's output rather
 * than the mapping it claims to carry.
 */
export function originalPositionFor(
    map: CombinedSourceMap,
    generatedLine: number,
    generatedColumn: number,
): { source: string; line: number; column: number } | null {
    const segments = decodeMappings(map.mappings)[generatedLine - 1];
    if (segments === undefined) return null;
    // The last segment at or before the column: a segment covers from its own generated
    // column up to the next one.
    let found: Mapping | undefined;
    for (const mapping of segments) {
        if (mapping.generatedColumn > generatedColumn - 1) break;
        if (mapping.source !== undefined) found = mapping;
    }
    if (found === undefined) return null;
    return {
        source: map.sources[found.source as number] as string,
        line: (found.sourceLine as number) + 1,
        column: (found.sourceColumn as number) + 1,
    };
}
