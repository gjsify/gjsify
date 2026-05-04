// Demonstrates @gjsify/process + @gjsify/terminal-native capabilities.
// Shows real pid/ppid, versions.gjs, isTTY, terminal dimensions,
// env enumeration/deletion, and terminal resize events.

console.log('=== @gjsify/process example ===\n');

// ── Process identity ──────────────────────────────────────────────────────────
console.log('--- Process identity ---');
console.log('process.pid:    ', process.pid);
console.log('process.ppid:   ', process.ppid);
console.log('process.platform:', process.platform);
console.log('process.arch:   ', process.arch);
console.log('process.title:  ', process.title);

// ── Version info ──────────────────────────────────────────────────────────────
// On GJS: versions.gjs is populated from the runtime; versions.node provides
// a compatibility string that npm packages use for version-gating.
// On Node.js: versions.node is the real engine version.
console.log('\n--- Versions ---');
console.log('process.version:', process.version);
for (const [key, val] of Object.entries(process.versions)) {
    console.log(`  process.versions.${key}: ${val}`);
}

// ── Environment variables ─────────────────────────────────────────────────────
// Object.keys() works via the ownKeys Proxy trap (GLib.listenv()).
// delete works via the deleteProperty Proxy trap (GLib.unsetenv()).
console.log('\n--- Environment ---');
const allKeys = Object.keys(process.env);
console.log('Number of env vars:', allKeys.length);
console.log('HOME:', process.env['HOME']);
console.log('PATH (first 60 chars):', (process.env['PATH'] ?? '').slice(0, 60) + '...');

// Set, read, and delete a custom env var
process.env['GJSIFY_EXAMPLE_VAR'] = 'hello';
console.log('Set GJSIFY_EXAMPLE_VAR:', process.env['GJSIFY_EXAMPLE_VAR']);
delete process.env['GJSIFY_EXAMPLE_VAR'];
const afterDelete = process.env['GJSIFY_EXAMPLE_VAR'];
console.log('After delete:', afterDelete === undefined ? 'undefined' : afterDelete);

// ── Current working directory ─────────────────────────────────────────────────
console.log('\n--- Working directory ---');
console.log('process.cwd():', process.cwd());

// ── Terminal (stdout) ─────────────────────────────────────────────────────────
// isTTY, columns and rows are backed by @gjsify/terminal-native (ioctl
// TIOCGWINSZ) when the native library is installed, with env/GLib fallback.
console.log('\n--- Terminal (stdout) ---');
console.log('process.stdout.isTTY:', process.stdout.isTTY);
if (process.stdout.isTTY) {
    console.log('process.stdout.columns:', process.stdout.columns);
    console.log('process.stdout.rows:   ', process.stdout.rows);
} else {
    console.log('(stdout is not a TTY — columns/rows not available)');
}

console.log('\n--- Terminal (stderr) ---');
console.log('process.stderr.isTTY:', process.stderr.isTTY);

// ── hrtime ────────────────────────────────────────────────────────────────────
console.log('\n--- hrtime ---');
const t0 = process.hrtime();
// do a small amount of work
let x = 0;
for (let i = 0; i < 1_000_000; i++) x += i;
void x;
const t1 = process.hrtime(t0);
console.log('hrtime baseline: [s, ns] =', t0);
console.log(`hrtime elapsed:  ${t1[0]}s ${t1[1]}ns (${(t1[1] / 1e6).toFixed(3)} ms)`);

// ── Terminal resize events (GJS + @gjsify/terminal-native only) ───────────────
// SIGWINCH is translated to a 'resize' GObject signal by ResizeWatcher inside
// @gjsify/process. The event is forwarded to process.stdout as a 'resize'
// event — the same API Node.js exposes.
if (process.stdout.isTTY) {
    console.log('\n--- Resize watcher ---');
    console.log('Listening for terminal resize (process.stdout on "resize").');
    console.log('Resize your terminal window to trigger it. Ctrl-C to exit.\n');

    let resizeCount = 0;
    process.stdout.on('resize', () => {
        resizeCount++;
        console.log(
            `[resize #${resizeCount}] columns=${process.stdout.columns} rows=${process.stdout.rows}`
        );
    });

    // On GJS the GLib main loop must run for signals to be delivered.
    // @gjsify/node-globals sets up the main loop automatically; we just
    // keep alive by scheduling a recurring check that exits after 30 s of
    // inactivity so the example terminates without manual Ctrl-C in CI.
    const deadline = Date.now() + 30_000;
    const timer = setInterval(() => {
        if (Date.now() >= deadline) {
            clearInterval(timer);
            console.log('\n(30 s elapsed — exiting)');
            process.exit(0);
        }
    }, 1_000);

} else {
    console.log('\n=== process example complete ===');
}
