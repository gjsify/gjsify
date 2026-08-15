// npm version → package-manager version.
//
// The three vocabularies disagree in ways that are silent rather than loud:
// npm's `1.2.0-rc.1` sorts BEFORE `1.2.0`, and so does Debian's and RPM's
// `1.2.0~rc.1` — but `1.2.0-rc.1` fed to dpkg is read as upstream `1.2.0` with
// revision `rc.1`, which sorts AFTER `1.2.0`. A prerelease that upgrades to
// nothing is the kind of defect that only shows up once a release is out, so
// the conversion happens here and is asserted rather than hoped for.

export interface NormalisedVersion {
    /** The version string to write into `Version:`. */
    version: string;
    /** Non-fatal transformations worth telling the user about. */
    warnings: string[];
}

// Spelled out rather than `\w`, which admits `_` — a character deb-version(7)
// does not allow. `1.0.0_beta` would pass here and dpkg would refuse the
// finished package at install time, one step too late to be useful.
/** `dpkg` upstream-version grammar, minus the `-` that separates the revision. */
const PACKAGE_VERSION = /^\d[A-Za-z0-9.+~]*$/;
/** Debian revision / RPM release. */
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9.+~]*$/;

/**
 * Convert an npm/semver version into one both dpkg and rpm order correctly.
 *
 * - a leading `v` is dropped (`v1.2.3` is a tag, not a version)
 * - `+buildmetadata` is dropped — neither format has a place for it, and both
 *   would sort it as part of the version
 * - `-prerelease` becomes `~prerelease`, with inner `-` flattened to `.`
 */
export function normaliseVersion(raw: string): NormalisedVersion {
    const warnings: string[] = [];
    let value = raw.trim();
    if (value.startsWith('v')) value = value.slice(1);

    const plus = value.indexOf('+');
    if (plus !== -1) {
        warnings.push(
            `gjsify ship: dropped the build metadata "${value.slice(plus)}" from version ${raw} — ` +
                'neither dpkg nor rpm has a field for it. Set `gjsify.ship.version` to pin an exact package version.',
        );
        value = value.slice(0, plus);
    }

    const dash = value.indexOf('-');
    if (dash !== -1) {
        const prerelease = value.slice(dash + 1).replace(/-/g, '.');
        value = `${value.slice(0, dash)}~${prerelease}`;
    }

    if (!PACKAGE_VERSION.test(value)) {
        throw new Error(
            `gjsify ship: "${raw}" is not a usable package version (normalised to "${value}"). ` +
                'It must start with a digit and contain only letters, digits, `.`, `+` and `~`. ' +
                'Set `gjsify.ship.version` in package.json to override it.',
        );
    }
    return { version: value, warnings };
}

/** Validate a Debian revision / RPM release. */
export function assertRelease(release: string): string {
    if (!RELEASE.test(release)) {
        throw new Error(
            `gjsify ship: "${release}" is not a usable package release. ` +
                'It must start with a letter or digit and contain only letters, digits, `.`, `+` and `~`. ' +
                'Set `gjsify.ship.release` in package.json.',
        );
    }
    return release;
}
