import type { ArgumentsCamelCase, MiddlewareFunction, BuilderCallback } from 'yargs';

export interface Command<T = unknown, U = T> {
    command: string | ReadonlyArray<string>;
    description: string;
    builder?: BuilderCallback<T, U>;
    handler?: (args: ArgumentsCamelCase<U>) => void | Promise<void>;
    middlewares?: MiddlewareFunction[];
    deprecated?: boolean | string;
}
