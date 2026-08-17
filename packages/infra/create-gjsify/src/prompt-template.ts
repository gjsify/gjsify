import { stdin, stdout } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import type { TemplateInfo } from './discover-templates.js';
import { RUNTIME_DESCRIPTIONS, type PackageManager } from './runtimes.js';
import { selectPackageManager, selectRuntime, type Selection } from './select.js';

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
};

/**
 * What a picker rejects with when the user hits Ctrl+C.
 *
 * A recognisable sentinel rather than a bare `throw`: the standalone bin hands
 * its handler to yargs, which turns a rejection into a stack trace followed by
 * the entire `--help` — what a user who deliberately backed out saw. It was
 * unreachable while `-t <template>` skipped the only prompt there was; the
 * runtime and package-manager pickers made aborting the normal way to change
 * your mind, so it is now on the common path.
 */
const CANCELLED = 'Cancelled by user';

/** `true` when `error` is a picker the user aborted with Ctrl+C. */
export function isCancelled(error: unknown): boolean {
    return error instanceof Error && error.message === CANCELLED;
}

/** One selectable row: the value returned, plus how it is drawn. */
export interface Choice<T> {
    value: T;
    label: string;
    /** Dimmed text after the label. Empty string draws nothing. */
    description: string;
}

/**
 * Render a choice list with one row highlighted.
 * First call: just draws. Subsequent calls move the cursor back up first.
 */
function render(choices: readonly Choice<unknown>[], selected: number, firstRender: boolean): void {
    if (!firstRender) {
        // Move cursor up over the previously drawn rows
        stdout.write(`\x1b[${choices.length}A`);
    }
    for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        const marker = i === selected ? `${c.cyan}❯${c.reset}` : ' ';
        const label = i === selected ? `${c.bold}${c.green}${choice.label}${c.reset}` : choice.label;
        const description = choice.description ? `  ${c.dim}${choice.description}${c.reset}` : '';
        // Clear line, then write content
        stdout.write(`\x1b[2K\r ${marker} ${label}${description}\n`);
    }
}

/**
 * Interactive arrow-key picker. Returns the selected value.
 * Throws if stdin is not a TTY — caller should check process.stdin.isTTY first.
 *
 * `initial` is the index the cursor starts on, so a prompt can open on the
 * answer the tool would have picked anyway (the host runtime, say) and Enter
 * alone is a valid response.
 */
export function promptChoice<T>(title: string, choices: readonly Choice<T>[], initial = 0): Promise<T> {
    if (choices.length === 0) {
        return Promise.reject(new Error(`Nothing to choose for "${title}".`));
    }

    return new Promise((resolve, reject) => {
        let selected = initial >= 0 && initial < choices.length ? initial : 0;

        stdout.write(
            `${c.bold}${title}${c.reset} ${c.dim}(↑/↓ to navigate, Enter to confirm, Ctrl+C to cancel)${c.reset}\n`,
        );
        render(choices, selected, true);

        emitKeypressEvents(stdin);
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();

        const cleanup = () => {
            stdin.removeListener('keypress', onKeypress);
            if (stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
        };

        const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
            if (!key) return;
            if (key.ctrl && key.name === 'c') {
                cleanup();
                stdout.write('\n');
                reject(new Error(CANCELLED));
                return;
            }
            if (key.name === 'up' || key.name === 'k') {
                selected = (selected - 1 + choices.length) % choices.length;
                render(choices, selected, false);
            } else if (key.name === 'down' || key.name === 'j') {
                selected = (selected + 1) % choices.length;
                render(choices, selected, false);
            } else if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                resolve(choices[selected].value);
            }
        };

        stdin.on('keypress', onKeypress);
    });
}

/** Interactive template picker. Returns the selected TemplateInfo. */
export function promptTemplate(templates: TemplateInfo[]): Promise<TemplateInfo> {
    if (templates.length === 0) {
        return Promise.reject(new Error('No templates available.'));
    }
    return promptChoice(
        'Select a template',
        templates.map((t) => ({ value: t, label: t.name, description: t.description })),
    );
}

/**
 * Interactive runtime picker, offering only what the chosen template declares.
 *
 * `initial` is the runtime `defaultRuntimeFor()` resolved to; it is passed in
 * rather than recomputed so the prompt opens on exactly the value the non-TTY
 * path would have used.
 */
export function promptRuntime(runtimes: readonly string[], initial: string): Promise<string> {
    return promptChoice(
        'Select a runtime',
        runtimes.map((runtime) => ({
            value: runtime,
            label: runtime,
            description: RUNTIME_DESCRIPTIONS[runtime] ?? '',
        })),
        runtimes.indexOf(initial),
    );
}

/** Interactive package-manager picker for the runtime already chosen. */
export function promptPackageManager(
    managers: readonly PackageManager[],
    initial: PackageManager,
): Promise<PackageManager> {
    return promptChoice(
        'Select a package manager',
        managers.map((manager) => ({ value: manager, label: manager, description: '' })),
        managers.indexOf(initial),
    );
}

/**
 * Carry out a {@link Selection}: print the notice, ask, or refuse.
 *
 * `undefined` means the caller should exit non-zero — the reason is already on
 * stderr. Notices go to stderr too, so a scripted `create-app … | tee` keeps the
 * next-steps block on stdout intact.
 */
async function settle<T>(
    selection: Selection<T>,
    ask: (choices: readonly T[], initial: T) => Promise<T>,
): Promise<T | undefined> {
    switch (selection.kind) {
        case 'value':
            return selection.value;
        case 'auto':
            console.error(selection.notice);
            return selection.value;
        case 'prompt':
            // The only throw here is the Ctrl+C sentinel `promptChoice` rejects
            // with, and an abort is an outcome, not a failure — report it the way
            // the refusal branch below reports one instead of unwinding.
            try {
                return await ask(selection.choices, selection.initial);
            } catch (error) {
                if (!isCancelled(error)) throw error;
                console.error('Cancelled.');
                return undefined;
            }
        case 'error':
            console.error(`Error: ${selection.message}`);
            return undefined;
    }
}

/** The two answers `createProject` needs beyond the template. */
export interface Setup {
    runtime: string;
    packageManager: PackageManager;
}

export interface SetupQuestion {
    /** The runtimes the chosen template declares AND this scaffolder can serve. */
    offered: readonly string[];
    /** `--runtime`, when given. */
    runtime?: string;
    /** `--package-manager`, when given. */
    packageManager?: PackageManager;
    /** Whether `--install` is set — i.e. whether the manager choice runs something. */
    install: boolean;
    /** Whether stdin is a TTY, i.e. whether a prompt is possible at all. */
    interactive: boolean;
}

/**
 * Settle runtime and package manager: flags, then prompts, then announced
 * defaults — the runtime first, because it decides which managers are legal.
 *
 * `undefined` means "exit non-zero, the reason is printed". Lives here rather
 * than in either bin because BOTH surfaces ask these two questions — `npm create
 * @gjsify/app` and `gjsify create`. A copy in one of them is a second answer to
 * the same question, which is exactly what let `gjsify create --install` reach
 * for npm on its own while the standalone bin refused to guess.
 */
export async function promptSetup(question: SetupQuestion): Promise<Setup | undefined> {
    const { offered, install, interactive } = question;

    const runtime = await settle(
        selectRuntime({ flag: question.runtime, offered, manager: question.packageManager, interactive }),
        (choices, initial) => promptRuntime(choices, initial),
    );
    if (runtime === undefined) return undefined;

    const packageManager = await settle(
        selectPackageManager({ flag: question.packageManager, runtime, install, interactive }),
        (choices, initial) => promptPackageManager(choices, initial),
    );
    if (packageManager === undefined) return undefined;

    return { runtime, packageManager };
}
