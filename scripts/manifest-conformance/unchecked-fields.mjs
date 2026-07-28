/**
 * The unchecked-field ledger.
 *
 * `field-coverage` derives the set of `gjsify.*` declaration kinds this tree
 * actually uses and fails on any key no rule claims. That guard is the reason
 * this whole package exists — a declaration nobody verifies is a promise that
 * can be false while every build exits 0, which is how every incident behind
 * these checks started.
 *
 * A guard with no honest escape gets routed around, so this is the escape:
 * "declared, deliberately not checked yet, and here is why". It is modelled on
 * `gjsify.platformsUncommitted` and is awkward to abuse in the same three ways —
 * the reason is mandatory, every entry is PRINTED on every run, and an entry
 * becomes a FAILURE the moment a rule claims the key or the field stops being
 * declared. It cannot ossify past its cause.
 *
 * Everything below is a FINDING, not a decision: these are declaration kinds
 * that were already unchecked before the consolidation and were deliberately
 * NOT fixed while restructuring, so that this change stays a refactor with
 * identical outcomes. Each entry is a candidate for its own follow-up.
 */

export const UNCHECKED_FIELDS = {
    example:
        'FINDING (pre-existing). `gjsify.example.runtimes` / `gjsify.example.node` promise which runtimes a showcase ' +
        'ships an artifact for, and AGENTS.md already records that two showcases (canvas2d-fireworks, ' +
        'excalibur-jelly-jumper) shipped a declared-but-unbuilt node entry, which reads to a user as a broken package. ' +
        'A rule would assert the declared runtimes agree with the `build` script + `files`. Deferred: adding it here ' +
        'would be fixing a finding inside a refactor.',
    main:
        'FINDING (pre-existing). `gjsify.main` is the GJS-first entry point twin of `gjsify.bin`, and `package-outputs` ' +
        'already checks `gjsify.bin` — the omission looks accidental rather than intended. Deferred for the same ' +
        'reason: extending an existing rule changes what the guard reports, which a pure refactor must not do.',
    storybook:
        'FINDING (pre-existing), and the only `gjsify.*` field this repo shares with downstream consumers today ' +
        '(buchhaltung, pixel-rpg/map-editor both declare it). `gjsify.storybook.stories` names a directory that ' +
        '`gjsify storybook` globs for `*.story.ts`; a typo there produces an empty component browser, not an error. ' +
        'Deferred to its own change.',
    defineFromPackageJson:
        'Build-time only: names package.json fields the bundler bakes into the bundle as defines. It promises nothing ' +
        'about a shipped artifact, so there is no on-disk fact a conformance rule could compare it against. Listed ' +
        'here rather than silently ignored so the judgement is reviewable.',
    nativescriptPlatforms:
        'FINDING (pre-existing). Declares the `ios`/`android` subset a NativeScript-axis package supports. Unlike ' +
        '`gjsify.platforms` there is no committed artifact per platform to check it against today, so a rule would ' +
        'have to assert something weaker (e.g. that a declared platform has a matching `*.ios.ts`/`*.android.ts` ' +
        'variant where the package ships platform-resolved sources). Deferred.',
    flatpak:
        'Configuration for `gjsify flatpak` (manifest path, app id, runtime versions), consumed by that command and ' +
        'validated by the four flatpak e2e suites when it is used. Not a promise about a shipped file. Listed rather ' +
        'than ignored.',
    buildCache:
        'A boolean opt-OUT of the per-package build cache (ADR 0006). It promises less, not more — a package that ' +
        'sets it always runs uncached, which cannot be wrong in the way a false declaration is. Nothing to conform to.',
};
