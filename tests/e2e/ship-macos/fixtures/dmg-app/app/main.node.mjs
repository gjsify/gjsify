// The payload, hand-written and therefore SOURCE — this fixture has no build step.
//
// `ship-stage` in `.github/workflows/main.yml` passes `--skip-build` for the same
// reason it does for `@gjsify/cli`: the stage job's subject is the STAGER, and a
// bundler run in front of it is one more thing that can fail in a job that is not
// about bundling. `tests/e2e/ship-macos/fixtures/window-app` is the fixture with a
// real build and a real runtime; it is the one that OPENS A WINDOW, on a Mac, in
// `node-gi.yml`'s `macos-app-selfcontained` leg. This one is wrapped in a UDIF
// image and read back on Linux, and nothing ever runs it.
console.log('ship-dmg-demo');
