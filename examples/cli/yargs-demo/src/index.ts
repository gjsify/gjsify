// Demonstrates: yargs CLI framework, ANSI colors, cross-platform output
// Reference: https://yargs.js.org/
// Reimplemented for GJS using @gjsify/node-globals (process, Buffer, etc.)

import '@gjsify/node-globals'; // Must be first — sets up process, Buffer, URL, etc.
import { runtimeName } from '@gjsify/runtime';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ANSI color/style helpers
const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    red:    '\x1b[31m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
};

function result(label: string, value: number): void {
    console.log(`  ${c.cyan}${label}${c.reset} = ${c.green}${c.bold}${value}${c.reset}`);
}

function operationLine(a: number, op: string, b: number): void {
    console.log(`  ${c.dim}${a} ${op} ${b}${c.reset}`);
}

const cli = yargs(hideBin(process.argv))
    .scriptName('calc')
    .usage(`\n${c.bold}gjsify calc${c.reset} — Simple calculator (yargs demo)\n\nUsage:\n  $0 <command> <a> <b>`)
    .command(
        'add <a> <b>',
        'Add two numbers',
        (y) => y
            .positional('a', { type: 'number', describe: 'First number' })
            .positional('b', { type: 'number', describe: 'Second number' }),
        (args) => {
            const a = args.a as number;
            const b = args.b as number;
            operationLine(a, '+', b);
            result('Result', a + b);
        }
    )
    .command(
        'sub <a> <b>',
        'Subtract b from a',
        (y) => y
            .positional('a', { type: 'number', describe: 'First number' })
            .positional('b', { type: 'number', describe: 'Second number' }),
        (args) => {
            const a = args.a as number;
            const b = args.b as number;
            operationLine(a, '-', b);
            result('Result', a - b);
        }
    )
    .command(
        'mul <a> <b>',
        'Multiply two numbers',
        (y) => y
            .positional('a', { type: 'number', describe: 'First number' })
            .positional('b', { type: 'number', describe: 'Second number' }),
        (args) => {
            const a = args.a as number;
            const b = args.b as number;
            operationLine(a, '×', b);
            result('Result', a * b);
        }
    )
    .command(
        'div <a> <b>',
        'Divide a by b',
        (y) => y
            .positional('a', { type: 'number', describe: 'Dividend' })
            .positional('b', { type: 'number', describe: 'Divisor' }),
        (args) => {
            const a = args.a as number;
            const b = args.b as number;
            if (b === 0) {
                console.error(`${c.red}Error: division by zero${c.reset}`);
                process.exit(1);
            }
            operationLine(a, '÷', b);
            result('Result', a / b);
        }
    )
    .version('0.0.4')
    .help()
    .epilog(`${c.dim}Runtime: ${runtimeName}${c.reset}`);

// If no args: run a demo showing all operations and print help
if (hideBin(process.argv).length === 0) {
    console.log(`\n${c.bold}gjsify calc${c.reset} — yargs CLI demo\n`);

    console.log(`${c.yellow}Demo calculations:${c.reset}`);

    console.log(`\n${c.dim}add 10 3${c.reset}`);
    operationLine(10, '+', 3);
    result('Result', 13);

    console.log(`\n${c.dim}sub 10 3${c.reset}`);
    operationLine(10, '-', 3);
    result('Result', 7);

    console.log(`\n${c.dim}mul 10 3${c.reset}`);
    operationLine(10, '×', 3);
    result('Result', 30);

    console.log(`\n${c.dim}div 10 3${c.reset}`);
    operationLine(10, '÷', 3);
    result('Result', 10 / 3);

    console.log(`\n${c.dim}Runtime: ${runtimeName}${c.reset}\n`);
    cli.showHelp();
} else {
    cli.parse();
}
