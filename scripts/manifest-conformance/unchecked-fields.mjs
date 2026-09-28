/**
 * The unchecked-field ledger — the honest escape from `field-coverage`, which derives
 * the `gjsify.*` declaration kinds this tree uses and fails on any key no rule claims.
 * A declaration nobody verifies is a promise that can be false while every build exits
 * 0, and a guard with no escape gets routed around instead.
 *
 * Modelled on `gjsify.platformsUncommitted` and awkward to abuse in the same three
 * ways: the reason is mandatory, every entry is PRINTED on every run, and an entry
 * becomes a FAILURE the moment a rule claims the key or the field stops being
 * declared. Each entry is a candidate for its own follow-up, never a decision.
 */

export const UNCHECKED_FIELDS = {
    defineFromPackageJson:
        'Build-time only: names package.json fields the bundler bakes into the bundle as defines. It promises nothing ' +
        'about a shipped artifact, so there is no on-disk fact a conformance rule could compare it against. Listed ' +
        'here rather than silently ignored so the judgement is reviewable.',
    flatpak:
        'Configuration for `gjsify flatpak` (manifest path, app id, runtime versions), consumed by that command and ' +
        'validated by the four flatpak e2e suites when it is used. Not a promise about a shipped file. Listed rather ' +
        'than ignored.',
    buildCache:
        'A boolean opt-OUT of the per-package build cache (ADR 0006). It promises less, not more — a package that ' +
        'sets it always runs uncached, which cannot be wrong in the way a false declaration is. Nothing to conform to.',
};
