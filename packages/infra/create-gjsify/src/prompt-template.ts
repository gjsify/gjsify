import { stdin, stdout } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import type { TemplateInfo } from './discover-templates.js';

const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    cyan:   '\x1b[36m',
    green:  '\x1b[32m',
};

/**
 * Render a templates list with one row highlighted.
 * First call: just draws. Subsequent calls move the cursor back up first.
 */
function render(templates: TemplateInfo[], selected: number, firstRender: boolean): void {
    if (!firstRender) {
        // Move cursor up over the previously drawn rows
        stdout.write(`\x1b[${templates.length}A`);
    }
    for (let i = 0; i < templates.length; i++) {
        const t = templates[i];
        const marker = i === selected ? `${c.cyan}❯${c.reset}` : ' ';
        const label = i === selected ? `${c.bold}${c.green}${t.name}${c.reset}` : t.name;
        // Clear line, then write content
        stdout.write(`\x1b[2K\r ${marker} ${label}  ${c.dim}${t.description}${c.reset}\n`);
    }
}

/**
 * Interactive template picker. Returns the selected TemplateInfo.
 * Throws if stdin is not a TTY — caller should check process.stdin.isTTY first.
 */
export function promptTemplate(templates: TemplateInfo[]): Promise<TemplateInfo> {
    if (templates.length === 0) {
        return Promise.reject(new Error('No templates available.'));
    }

    return new Promise((resolve, reject) => {
        let selected = 0;

        stdout.write(`${c.bold}Select a template${c.reset} ${c.dim}(↑/↓ to navigate, Enter to confirm, Ctrl+C to cancel)${c.reset}\n`);
        render(templates, selected, true);

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
                reject(new Error('Cancelled by user'));
                return;
            }
            if (key.name === 'up' || key.name === 'k') {
                selected = (selected - 1 + templates.length) % templates.length;
                render(templates, selected, false);
            } else if (key.name === 'down' || key.name === 'j') {
                selected = (selected + 1) % templates.length;
                render(templates, selected, false);
            } else if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                resolve(templates[selected]);
            }
        };

        stdin.on('keypress', onKeypress);
    });
}
