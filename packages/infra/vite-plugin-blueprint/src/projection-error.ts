import type { ProjectedLoss } from '@gjsify/blueprint';

/**
 * A `.blp` asked for as a shared tree whose projection would have dropped something.
 *
 * WHY THIS IS A REFUSAL AND NOT A WARNING. The projection is lossy by construction (ADR 0053
 * clause 1) and it says what it dropped. A build that emitted the tree anyway would hand a
 * renderer a smaller UI than the source describes, with nothing downstream able to tell: the
 * GTK build of the same file stays complete, so the template reads as shared and working while
 * one surface silently renders less. That failure is expensive exactly because it is invisible,
 * and a warning in a build log is invisible in the same way.
 *
 * WHY IT CARRIES THE LOSSES AND NOT JUST A SENTENCE. `lost` is the porting task: each entry is
 * a construct and the line it sits on, so a consumer — a vite config, a CI step, a codemod —
 * can group or count them without re-parsing the file. The message spells the same thing for a
 * human, one loss per line, because a build failure is read before it is caught.
 */
export class BlueprintProjectionError extends Error {
    /** The `.blp` that was asked for, with no query attached. */
    readonly file: string;
    /** Every loss the projection declared, in the order it declared them. */
    readonly lost: readonly ProjectedLoss[];

    constructor(file: string, lost: readonly ProjectedLoss[]) {
        // One loss per line and the kind named before the place, because the kind decides
        // whether this file can be shared at all and the line only says where to start.
        const listed = lost.map((loss) => `  ${loss.kind} at ${file}:${loss.line}`).join('\n');
        super(
            `${file} cannot be used as a shared tree: its projection drops ` +
                `${lost.length} construct(s) the node shape has no spelling for.\n${listed}\n` +
                'The GtkBuilder-XML exit of the same file is unaffected — import it without ' +
                '`?shared-tree` to build it for GTK. To share it, replace the constructs above ' +
                'with ones the shared node carries, or render this surface from its own tree.',
        );
        this.name = 'BlueprintProjectionError';
        this.file = file;
        this.lost = lost;
    }
}
