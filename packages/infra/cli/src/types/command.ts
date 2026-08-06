import type { ArgumentsCamelCase, MiddlewareFunction, BuilderCallback } from 'yargs';

export interface Command<T = unknown, U = T> {
    command: string | ReadonlyArray<string>;
    description: string;
    builder?: BuilderCallback<T, U>;
    // Optional because PARENT commands are real: `flatpakCommand`
    // (`src/commands/flatpak/index.ts`) only registers subcommands through its
    // builder and has nothing to run itself. Leaf commands should use
    // {@link LeafCommand} instead — see there for what the loose type cost.
    handler?: (args: ArgumentsCamelCase<U>) => void | Promise<void>;
    middlewares?: MiddlewareFunction[];
    deprecated?: boolean | string;
}

/**
 * A command that definitely runs something — the shape of every command except
 * the builder-only parents.
 *
 * WHY IT EXISTS: `Command.handler` has to stay optional for parent commands,
 * but that optionality then lands on every CALL site, including the ones
 * outside `cli-app.ts`'s yargs registration where a missing handler would be a
 * silent no-op rather than a type error. `src/affected-entry.ts` — the entry
 * the committed `dist/affected.gjs.mjs` is built from — invoked
 * `affectedCommand.handler(...)` through a cast that suppressed exactly that,
 * and nothing noticed for as long as the package's tsconfig scoped the compile
 * to the import closure of `src/index.ts`. Annotate a command that a standalone
 * entry invokes directly with this type, and the guarantee is in the type
 * instead of in a cast.
 */
export type LeafCommand<T = unknown, U = T> = Command<T, U> & {
    handler: NonNullable<Command<T, U>['handler']>;
};
