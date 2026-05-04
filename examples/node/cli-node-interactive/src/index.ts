// Interactive CLI demonstrating @inquirer/prompts + yargs on Node.js and GJS.
// Uses yargs for command routing and @inquirer/prompts for interactive input.
//
// Run modes:
//   No args  → interactive wizard (asks questions one by one)
//   greet    → greet command (prompts for name + style)
//   survey   → multi-question survey (input, select, confirm, checkbox)
//   --help   → yargs usage

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  input,
  select,
  confirm,
  checkbox,
  password,
} from '@inquirer/prompts';

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue:   '\x1b[34m',
};

function header(title: string): void {
  console.log(`\n${c.bold}${c.cyan}${title}${c.reset}\n`);
}

function ok(msg: string): void {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

function result(label: string, value: string): void {
  console.log(`  ${c.dim}${label}:${c.reset} ${c.bold}${value}${c.reset}`);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function runGreet(): Promise<void> {
  header('Greet command — @inquirer/prompts demo');

  const name = await input({ message: 'What is your name?' });

  const style = await select({
    message: 'How should I greet you?',
    choices: [
      { value: 'formal',   name: 'Formal   — "Good day, <name>"' },
      { value: 'casual',   name: 'Casual   — "Hey, <name>!"' },
      { value: 'pirate',   name: 'Pirate   — "Ahoy, <name>!"' },
      { value: 'robot',    name: 'Robot    — "GREETINGS, <NAME>"' },
    ],
  });

  const greetings: Record<string, string> = {
    formal: `Good day, ${name}.`,
    casual: `Hey, ${name}!`,
    pirate: `Ahoy, ${name}! Arrr!`,
    robot:  `GREETINGS, ${name.toUpperCase()}. BEEP BOOP.`,
  };

  console.log(`\n${c.bold}${c.yellow}${greetings[style]}${c.reset}\n`);
}

async function runSurvey(): Promise<void> {
  header('Developer survey — @inquirer/prompts demo');

  const username = await input({
    message: 'GitHub username:',
    validate: (v) => v.trim().length > 0 || 'Please enter a username',
  });

  const experience = await select({
    message: 'Years of experience:',
    choices: [
      { value: '<1',   name: 'Less than 1 year' },
      { value: '1-3',  name: '1 – 3 years' },
      { value: '3-5',  name: '3 – 5 years' },
      { value: '5-10', name: '5 – 10 years' },
      { value: '10+',  name: 'More than 10 years' },
    ],
  });

  const langs = await checkbox({
    message: 'Favourite languages (space to toggle, enter to confirm):',
    choices: [
      { value: 'typescript', name: 'TypeScript', checked: true },
      { value: 'rust',       name: 'Rust' },
      { value: 'python',     name: 'Python' },
      { value: 'go',         name: 'Go' },
      { value: 'kotlin',     name: 'Kotlin' },
      { value: 'zig',        name: 'Zig' },
    ],
  });

  const token = await password({
    message: 'Secret token (masked, not stored):',
    mask: '*',
  });

  const submit = await confirm({
    message: 'Submit survey?',
    default: true,
  });

  if (!submit) {
    console.log(`\n${c.dim}Survey cancelled.${c.reset}\n`);
    return;
  }

  console.log(`\n${c.bold}Survey results:${c.reset}`);
  result('Username',    username);
  result('Experience',  experience);
  result('Languages',   langs.join(', ') || '(none)');
  result('Token length', `${token.length} chars`);
  ok('Submitted!\n');
}

async function runWizard(): Promise<void> {
  header('Interactive wizard — yargs + @inquirer/prompts');
  console.log(`${c.dim}This wizard demonstrates @inquirer/prompts running on GJS and Node.js.${c.reset}`);
  console.log(`${c.dim}Use arrow keys to navigate, space to toggle checkboxes, enter to confirm.${c.reset}\n`);

  const mode = await select({
    message: 'What would you like to do?',
    choices: [
      { value: 'greet',  name: 'Greet me (input + select)' },
      { value: 'survey', name: 'Developer survey (input + select + checkbox + password + confirm)' },
      { value: 'quit',   name: 'Quit' },
    ],
  });

  if (mode === 'greet')  await runGreet();
  if (mode === 'survey') await runSurvey();
  if (mode === 'quit')   console.log(`\n${c.dim}Goodbye!${c.reset}\n`);
}

// ── CLI routing via yargs ─────────────────────────────────────────────────────

const args = hideBin(process.argv);

if (args.length === 0) {
  // No arguments: run the interactive wizard
  runWizard().catch((err: unknown) => {
    if (err instanceof Error && err.name === 'ExitPromptError') {
      console.log(`\n${c.dim}(interrupted)${c.reset}\n`);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
} else {
  const cli = yargs(args)
    .scriptName('interactive')
    .usage(`\n${c.bold}gjsify interactive${c.reset} — @inquirer/prompts demo\n\nUsage:\n  $0 [command]`)
    .command('greet', 'Interactive greeting (input + select)', {}, () => {
      runGreet().catch(console.error);
    })
    .command('survey', 'Developer survey (all prompt types)', {}, () => {
      runSurvey().catch(console.error);
    })
    .help()
    .version('0.2.0')
    .epilog(`${c.dim}Runs on both GJS (gjsify run) and Node.js${c.reset}`);

  cli.parse();
}
