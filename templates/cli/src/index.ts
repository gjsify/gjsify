import { runtimeName } from '@gjsify/runtime';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    cyan:   '\x1b[36m',
    green:  '\x1b[32m',
};

yargs(hideBin(process.argv))
    .scriptName('new-gjsify-app')
    .usage(`\n${c.bold}new-gjsify-app${c.reset} — a gjsify CLI starter`)
    .command(
        'greet [name]',
        'Print a greeting',
        (y) => y.positional('name', { type: 'string', default: 'world' }),
        (args) => {
            console.log(`${c.cyan}Hello, ${c.bold}${args.name}${c.reset}${c.cyan}!${c.reset}`);
        },
    )
    .command(
        'info',
        'Show runtime info',
        () => {},
        () => {
            console.log(`${c.dim}runtime :${c.reset} ${c.green}${runtimeName}${c.reset}`);
            console.log(`${c.dim}platform:${c.reset} ${process.platform}`);
            console.log(`${c.dim}pid     :${c.reset} ${process.pid}`);
        },
    )
    .demandCommand(1, 'Pass --help to see available commands.')
    .strict()
    .help()
    .parse();
