// Fixture rc for cli.spec.ts. Exercises cosmiconfig's ESM `.js` loader, which
// does dynamic `import(filepath)` on an absolute path. Node tolerates that as
// a non-spec extension; SpiderMonkey/GJS rejects it with
// "Module not found: <abs-path>" — the loader must convert via pathToFileURL
// for both runtimes to work.
//
// Also intentionally not named `.ts-for-girrc.js` — the default cosmiconfig
// search must not pick it up; only explicit --configName loads it.
export default {
    girDirectories: ['./girs'],
    ignore: ['Gwebgl-0.1'],
};
