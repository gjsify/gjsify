// The runtime / package-manager decision, as data. These functions decide;
// `index.ts` is the shell that prints, prompts and exits. Each answer depends on a
// flag, on what the template declares, on the other question's answer, and on
// whether there is a TTY — deciding that inline in the yargs handler made it
// reachable only by spawning the binary, so the half that matters most, the
// non-TTY one, was covered by nothing but an end-to-end scaffold.

import { defaultRuntimeFor, packageManagersForRuntime, type PackageManager } from './runtimes.js';

/** What the caller should do about a choice. */
export type Selection<T> =
    /** Settled, and the user already knows why (they said so on the command line). */
    | { kind: 'value'; value: T }
    /** Settled without being asked — print `notice` so it is not a silent default. */
    | { kind: 'auto'; value: T; notice: string }
    /** Ask, opening on `initial`. */
    | { kind: 'prompt'; choices: readonly T[]; initial: T }
    /** Refuse, with a message that says what to pass instead. */
    | { kind: 'error'; message: string };

export interface RuntimeQuestion {
    flag?: string;
    /** The runtimes the chosen template declares AND this scaffolder can serve. */
    offered: readonly string[];
    /** `--package-manager`, when given — it narrows the runtime. */
    manager?: PackageManager;
    /** Whether stdin is a TTY, i.e. whether a prompt is possible at all. */
    interactive: boolean;
}

/**
 * Settle which runtime the project is set up for.
 *
 * `--runtime` is deliberately NOT mandatory on a non-TTY the way `--template` is:
 * a template is a choice of WHAT gets written and has no defensible default, while
 * the runtime changes not one scaffolded byte (every template ships a bundle for
 * every runtime it declares) and only names the start script. So it defaults —
 * announced, not assumed.
 */
export function selectRuntime(question: RuntimeQuestion): Selection<string> {
    const { flag, offered, manager, interactive } = question;

    if (flag !== undefined) {
        if (offered.length > 0 && !offered.includes(flag)) {
            return {
                kind: 'error',
                message: `this template does not run on "${flag}". Declared runtimes: ${offered.join(', ')}.`,
            };
        }
        return { kind: 'value', value: flag };
    }

    // One declared runtime is not a choice — take it without asking.
    if (offered.length === 1) return { kind: 'value', value: offered[0] };
    // None at all means the template declares runtimes this build has no
    // installer mapping for (`supportedRuntimes` drops the ones it cannot serve),
    // i.e. the template is newer than the scaffolder. Refuse rather than fall
    // back to the host: picking a runtime the template never claimed buries the
    // real cause under whatever fails next. `--runtime` above still overrides,
    // which is the escape hatch for a template that declares nothing at all.
    if (offered.length === 0) {
        return { kind: 'error', message: 'this template declares no runtime this scaffolder can install for.' };
    }

    const fallback = defaultRuntimeFor(offered, manager);
    if (fallback === undefined) {
        return {
            kind: 'error',
            message:
                `no runtime this template declares installs with "${manager}". ` +
                `Declared runtimes: ${offered.join(', ')}.`,
        };
    }

    // A pinned manager has ALREADY answered this question — bun installs for bun
    // and nothing else — so prompting would pose a question with one honest
    // answer. It is still reported, because the user did not name a runtime.
    if (manager !== undefined) {
        return {
            kind: 'auto',
            value: fallback,
            notice: `Setting up for ${fallback} — the runtime ${manager} installs for.`,
        };
    }
    if (interactive) return { kind: 'prompt', choices: offered, initial: fallback };
    return {
        kind: 'auto',
        value: fallback,
        notice: `--runtime not given, using "${fallback}". Runs on: ${offered.join(', ')}.`,
    };
}

export interface PackageManagerQuestion {
    flag?: PackageManager;
    /** The runtime already settled by {@link selectRuntime}. */
    runtime: string;
    /** Whether `--install` is set — i.e. whether this choice actually runs something. */
    install: boolean;
    interactive: boolean;
}

/**
 * Settle which package manager installs the project.
 *
 * Two rules differ from the runtime above, both because a manager DOES something.
 * A runtime offering exactly one is not a question — bun and deno install for
 * themselves, the gjs column has no Node to run npm with — so it is taken and
 * named rather than prompted. And with `--install` on a non-TTY, the flag is
 * REQUIRED: this is the one default that would reach the user's disk, picking the
 * installer that writes their node_modules and lockfile.
 */
export function selectPackageManager(question: PackageManagerQuestion): Selection<PackageManager> {
    const { flag, runtime, install, interactive } = question;

    const managers = packageManagersForRuntime(runtime);
    if (managers === undefined || managers.length === 0) {
        return { kind: 'error', message: `no package manager known for runtime "${runtime}".` };
    }

    if (flag !== undefined) {
        if (!managers.includes(flag)) {
            return {
                kind: 'error',
                message:
                    `"${flag}" cannot install a project you intend to run on ${runtime}. ` +
                    `Package managers for ${runtime}: ${managers.join(', ')}.`,
            };
        }
        return { kind: 'value', value: flag };
    }

    if (managers.length === 1) {
        return {
            kind: 'auto',
            value: managers[0],
            notice: `Using ${managers[0]} — the only package manager that installs for ${runtime}.`,
        };
    }
    if (interactive) return { kind: 'prompt', choices: managers, initial: managers[0] };
    if (install) {
        return {
            kind: 'error',
            message:
                '--package-manager is required with --install in non-interactive mode. ' +
                `Package managers for ${runtime}: ${managers.join(', ')}.`,
        };
    }
    return {
        kind: 'auto',
        value: managers[0],
        notice: `--package-manager not given, using "${managers[0]}" for ${runtime}.`,
    };
}
