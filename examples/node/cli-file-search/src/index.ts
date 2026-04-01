// Recursive file search (simplified grep) for Node.js and GJS
// Demonstrates: fs (readdir, stat, createReadStream), path, readline, process

import '@gjsify/node-globals';
import { runtimeName } from '@gjsify/runtime';
import { readdirSync, statSync, createReadStream } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createInterface } from 'node:readline';

// ANSI color codes
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

// File extensions to search (text-based files)
const TEXT_EXTENSIONS = new Set([
  '.ts', '.js', '.mjs', '.cjs', '.mts', '.cts',
  '.json', '.md', '.txt', '.html', '.css', '.xml',
  '.yaml', '.yml', '.toml', '.sh', '.bash',
  '.py', '.rb', '.go', '.rs', '.c', '.h', '.cpp',
  '.java', '.kt', '.swift', '.ejs', '.hbs',
  '.svg', '.graphql', '.sql', '.env', '.gitignore',
  '.editorconfig', '.prettierrc', '.eslintrc',
]);

interface SearchResult {
  file: string;
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchStats {
  filesSearched: number;
  filesMatched: number;
  totalMatches: number;
}

/** Check if a file is likely a text file based on extension. */
function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || ext === '';
}

/** Directories to skip during search. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.cache',
  'coverage', '.nyc_output', '__pycache__', '.tox',
]);

/** Collect all searchable files recursively. */
function collectFiles(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.env' && entry !== '.editorconfig') continue;
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        collectFiles(fullPath, files);
      } else if (stat.isFile() && isTextFile(fullPath)) {
        files.push(fullPath);
      }
    } catch {
      // Skip files we can't stat
    }
  }

  return files;
}

/** Search a single file for the pattern, line by line using streams. */
function searchFile(filePath: string, pattern: RegExp): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const results: SearchResult[] = [];
    let lineNum = 0;

    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line: string) => {
      lineNum++;
      const match = pattern.exec(line);
      if (match) {
        results.push({
          file: filePath,
          line: lineNum,
          content: line,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
        });
      }
    });

    rl.on('close', () => resolve(results));
    rl.on('error', reject);
    stream.on('error', () => resolve(results)); // Skip unreadable files
  });
}

/** Highlight the match in a line with ANSI colors. */
function highlightMatch(result: SearchResult): string {
  const { content, matchStart, matchEnd } = result;
  const before = content.slice(0, matchStart);
  const match = content.slice(matchStart, matchEnd);
  const after = content.slice(matchEnd);
  return `${before}${RED}${BOLD}${match}${RESET}${after}`;
}

/** Format a search result for display. */
function formatResult(result: SearchResult, baseDir: string): string {
  const relPath = relative(baseDir, result.file);
  const lineStr = `${DIM}${result.line}${RESET}`;
  const highlighted = highlightMatch(result);
  return `${CYAN}${relPath}${RESET}:${GREEN}${lineStr}${RESET}: ${highlighted}`;
}

/** Main search function. */
async function search(pattern: string, directory: string): Promise<void> {
  const startTime = Date.now();
  const stats: SearchStats = { filesSearched: 0, filesMatched: 0, totalMatches: 0 };

  // Build regex
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    console.error(`${RED}Invalid pattern: ${pattern}${RESET}`);
    return;
  }

  console.log(`${DIM}Searching for "${YELLOW}${pattern}${RESET}${DIM}" in ${directory}${RESET}`);
  console.log(`${DIM}Runtime: ${runtimeName}${RESET}`);
  console.log('');

  // Collect all files
  const files = collectFiles(directory);
  stats.filesSearched = files.length;

  // Search each file
  for (const file of files) {
    const results = await searchFile(file, new RegExp(pattern));

    if (results.length > 0) {
      stats.filesMatched++;
      stats.totalMatches += results.length;

      for (const result of results) {
        console.log(formatResult(result, directory));
      }
    }
  }

  // Summary
  const elapsed = Date.now() - startTime;
  console.log('');
  console.log(`${DIM}─────────────────────────────────${RESET}`);
  console.log(`${GREEN}${stats.totalMatches}${RESET} matches in ${GREEN}${stats.filesMatched}${RESET} files (searched ${stats.filesSearched} files in ${elapsed}ms)`);
}

// Parse arguments — On Node.js argv = [node, script, ...args] (slice 2),
// on GJS argv = [gjs, ...args] (slice 1). Detect by checking if argv[1]
// looks like a file path ending in .js/.mjs.
const argvOffset = process.argv.length >= 2 && /\.[cm]?[jt]s$/.test(process.argv[1]) ? 2 : 1;
const args = process.argv.slice(argvOffset);

if (args.length < 1) {
  console.log(`${BOLD}gjsify file-search${RESET} — Recursive file search (like grep -rn)`);
  console.log('');
  console.log(`${YELLOW}Usage:${RESET}`);
  console.log('  file-search <pattern> [directory]');
  console.log('');
  console.log(`${YELLOW}Examples:${RESET}`);
  console.log('  file-search "createServer" .');
  console.log('  file-search "import.*from" src/');
  console.log('  file-search "TODO|FIXME" .');
  console.log('');
  console.log(`${DIM}Runtime: ${runtimeName}${RESET}`);

  // Demo: search this project's src directory
  console.log('');
  console.log(`${DIM}Running demo search...${RESET}`);
  await search('createReadStream', process.cwd());
} else {
  const pattern = args[0];
  const directory = args[1] || process.cwd();
  await search(pattern, directory);
}
