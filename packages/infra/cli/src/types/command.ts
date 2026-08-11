import type { ArgumentsCamelCase, MiddlewareFunction, BuilderCallback } from 'yargs';

export interface Command<T = unknown, U = T> {
    command: string | ReadonlyArray<string>;
    description: string;
    builder?: BuilderCallback<T, U>;
    // Optional because PARENT commands are real: `flatpakCommand` only registers
    // subcommands through its builder and has nothing to run. Leaf commands use
    // {@link LeafCommand} instead — see there for what the loose type cost.
    handler?: (args: ArgumentsCamelCase<U>) => void | Promise<void>;
    middlewares?: MiddlewareFunction[];
    deprecated?: boolean | string;
}

/**
 * A command that definitely runs something — every command except the
 * builder-only parents. Annotate any command a standalone entry invokes directly.
 *
 * `Command.handler` must stay optional for parent commands, but that optionality
 * then lands on every CALL site, including those outside `cli-app.ts`'s yargs
 * registration, where a missing handler is a silent no-op rather than a type
 * error. `src/affected-entry.ts` — the entry `dist/affected.gjs.mjs` is built
 * from — invoked `affectedCommand.handler(...)` through a cast that suppressed
 * exactly that, unnoticed for as long as the tsconfig scoped the compile to the
 * import closure of `src/index.ts`. This puts the guarantee in the type instead.
 */
export type LeafCommand<T = unknown, U = T> = Command<T, U> & {
    handler: NonNullable<Command<T, U>['handler']>;
};
