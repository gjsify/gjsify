// `Contents/Info.plist` and `Contents/PkgInfo` — what makes a `*.app` directory
// an application BUNDLE rather than a directory whose name ends in `.app`.
//
// M1 staged `<Name>.app/Contents/{MacOS,Resources}` with no `Info.plist` at all.
// LaunchServices reads that file to learn which file under `Contents/MacOS` to
// exec and what identity to register the bundle under, so without it the tree is
// a directory the Finder shows as a folder — the hole #1354 M2a closes.
//
// XML, never the binary variant, and that is an ORACLE decision rather than a
// taste one. `plistlib` reads both, but a binary plist this tree wrote and then
// read back with a reader this tree also wrote is `selfReading: true` — ADR 0024
// § A3 calls that legal to declare and illegal to release. CPython's `plistlib`
// is a different implementation family and is already precedent here
// (`.github/ship-oracle/verify-modes.py`), and it parses the XML form.
//
// EVERY KEY BELOW IS CITED to a file in `refs/` that a real macOS toolchain
// produced or consumes. Keys that are merely plausible — `CFBundleIconFile`,
// `LSMinimumSystemVersion`, `NSHighResolutionCapable`, `LSApplicationCategoryType`,
// `NSHumanReadableCopyright` — are not emitted, because nothing a reader here can
// open contains them.
//
// AND THE SCOPE OF THAT MEASUREMENT IS PART OF IT, because `grep -r … refs/` is a
// command that answers cheerfully after reading almost nothing: 89 of the 95
// submodules `.gitmodules` declares are not checked out in a working tree, and an
// empty directory produces zero hits with no error. Measured on a checkout with
// SIX of them present (`cambalache`, `gtkx`, `libadwaita`, `metro`, `node`,
// `peachy`): 0 files for each of the five keys above, against 3 files for
// `CFBundleSignature` as the CONTROL — a string known to be there, which is what
// makes the zeros mean anything. So the claim is "absent from the six pools a
// reader can open", not "absent from the pool", and a key that turns up in a
// seventh is a citation waiting to be written, not a contradiction.

import type { LayoutMetadataInput } from './layout.js';

/** Where the two files live inside a bundle. Apple's names, not ours. */
export const BUNDLE_INFO_PLIST = 'Contents/Info.plist';
export const BUNDLE_PKGINFO = 'Contents/PkgInfo';

/**
 * The four-character bundle type of an application, and the signature that says
 * "none".
 *
 * `refs/node/tools/gyp/pylib/gyp/mac_tool.py:232` reads `CFBundlePackageType` and
 * writes a `PkgInfo` only when it is `APPL`; line 239 defaults
 * `CFBundleSignature` to `????` and line 240 resets a signature of the wrong
 * length to the same four question marks. `refs/node/deps/v8/gni/Info.plist:22`
 * spells `????` out.
 */
const PACKAGE_TYPE = 'APPL';
const SIGNATURE = '????';

/**
 * The one XML escape set a plist needs.
 *
 * `&` first, or the ampersands introduced by the later replacements get escaped
 * twice and `CFBundleName` comes out as `Ship &amp;amp; Co`. `<` and `>` are the
 * element delimiters; `"` and `'` are not special in element CONTENT, which is
 * the only place this function's output ever lands, so they are left alone
 * rather than turned into entities a human reading the file has to decode.
 */
function xmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Refuse a value a plist cannot carry, naming the field.
 *
 * XML 1.0 has no escape for most C0 control characters — they are not
 * representable in a document at all, not merely inconvenient — so a name
 * carrying one produces a file `plistlib` and `CFPropertyList` both reject. The
 * refusal is here rather than at parse time on a Mac three milestones away.
 *
 * C0 MINUS TAB/LF/CR, AND NOTHING ELSE — measured against the oracle rather than
 * reasoned from the spec, because the first cut of this guard also refused DEL
 * and the C1 range on the stated grounds that XML forbids them, and XML 1.0 does
 * not. Probed through `plistlib` on CPython 3.14, one code point per document:
 *
 *     U+0001, U+0008, U+000B   ExpatError: not well-formed (invalid token)
 *     U+0009 (TAB)             accepted
 *     U+007F (DEL)             accepted
 *     U+0085, U+009F (C1)      accepted
 *
 * So refusing those four would reject a name every reader in the chain reads
 * back correctly — a guard that turns working packages into failures, which buys
 * nothing over the defect it prevents. The rule that survives is the measured
 * one; the reason that did not is recorded here rather than quietly dropped,
 * because a rule carrying an invented reason is one that gets "simplified" back
 * into the bug.
 */
function assertPlistText(value: string, field: string, configKey: string): string {
    // A SCAN rather than a character class, and not only to keep `no-control-regex`
    // quiet: the code point is what the message needs, and lifting it back out of
    // a match is a second step that can disagree with the first.
    let point = -1;
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;
        // Tab, LF and CR are the three C0 code points XML 1.0 does carry.
        if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
            point = code;
            break;
        }
    }
    if (point !== -1) {
        throw new Error(
            `gjsify ship: ${field} would carry the control character ` +
                `U+${point.toString(16).padStart(4, '0').toUpperCase()}, and XML has no escape for it — the ` +
                'Info.plist would be unparseable by every reader macOS has. Set ' +
                `\`${configKey}\` to a value without it.`,
        );
    }
    return value;
}

/** One `<key>…</key><string>…</string>` pair, indented to sit inside the top-level `<dict>`. */
function stringEntry(key: string, value: string): string {
    return `\t<key>${key}</key>\n\t<string>${xmlText(value)}</string>`;
}

/** `CFBundleSupportedPlatforms` is the one array here — see the key table below. */
function arrayEntry(key: string, values: readonly string[]): string {
    const items = values.map((value) => `\t\t<string>${xmlText(value)}</string>`).join('\n');
    return `\t<key>${key}</key>\n\t<array>\n${items}\n\t</array>`;
}

/**
 * Render `Contents/Info.plist`.
 *
 * The eleven keys, each with the file in `refs/` it was read off (all paths
 * relative to the repository root, all read-only submodules):
 *
 * | key | value | citation |
 * |---|---|---|
 * | `CFBundleExecutable` | `binaryName` | `refs/node/test/fixtures/macos-app-sandbox/Info.plist:5` |
 * | `CFBundleIdentifier` | `appId` | same file, line 7 |
 * | `CFBundleInfoDictionaryVersion` | `6.0` | same file, line 9 |
 * | `CFBundleName` | `name` | same file, line 11 |
 * | `CFBundlePackageType` | `APPL` | same file, line 13 |
 * | `CFBundleShortVersionString` | `version` | same file, line 15 |
 * | `CFBundleSupportedPlatforms` | `["MacOSX"]` | same file, lines 17-20 |
 * | `CFBundleVersion` | `version-release` | same file, line 21 |
 * | `CFBundleDevelopmentRegion` | `en` | `refs/node/deps/v8/gni/Info.plist:5` |
 * | `CFBundleDisplayName` | `name` | same file, line 7 |
 * | `CFBundleSignature` | `????` | same file, line 21 |
 *
 * `CFBundleVersion` carries the RELEASE and `CFBundleShortVersionString` does
 * not, which is the one place the two differ. Apple's rule is that the short
 * string is the marketing version a user sees and `CFBundleVersion` is the build
 * — and this command already has that exact pair: `version` is upstream's,
 * `release` is the packaging revision within it (the deb revision, the rpm
 * release). Emitting `version` twice would throw the distinction away on the one
 * OS that has a field for it.
 *
 * KEYS DELIBERATELY ABSENT are listed in this module's header. `CFBundleIconFile`
 * is the one a reader will reach for first, and it is absent for a reason that
 * outlives the key: M2a ships NO icon. `png2icns`, `icnsutil` and `iconutil` are
 * all absent from this workstation and from the CI image, so an `.icns` written
 * here could only be read back by a reader written here — `selfReading: true`,
 * which `flatpak.spec.ts` reds. The unblocker is an independent Linux ICNS reader
 * entering the CI image; until one does, the hicolor PNG/SVG the payload already
 * carries stays the only icon, unread on macOS.
 *
 * A TWELFTH KEY, `ATSApplicationFontsPath`, is emitted when the bundle carries
 * faces, and it is the first one here NOT cited to `refs/` — so the exception is
 * stated rather than left to be noticed (ADR 0037). The rule this module opens
 * with exists against DECORATION: the five absent keys are cosmetic, nothing a
 * reader here can open contains them, and emitting one would be a guess with no
 * observable behind it. This key is a MECHANISM, and its citation is Apple's own
 * *Information Property List Key Reference*, which states the scope in the terms
 * this command needs: *"If present, macOS activates the fonts at the specified
 * path for use by the bundled app. The fonts are activated only for the bundled
 * app and not for the system as a whole."* The value is a path relative to
 * `Contents/Resources`.
 *
 * It is also the only route there is. Pango on macOS is CoreText-backed, GTK is
 * not built against fontconfig on that platform, and
 * `pango_font_map_add_font_file()` answers `G_IO_ERROR_NOT_SUPPORTED` on the
 * CoreText map — so the alternatives are this key or a `CTFontManager` call made
 * from inside somebody else's application, which is not a packaging command's
 * business.
 *
 * WHAT THE ORACLE CAN AND CANNOT SEE: `plistlib` reads the key back like any
 * other, so the FILE is checked. That macOS activates the directory, and that
 * Pango's CoreText map then holds the family, is unverified here — which is what
 * `Layout.fontGap` says out loud rather than letting a green stage imply.
 */
export function renderInfoPlist(input: LayoutMetadataInput, fontsPath?: string): string {
    const name = assertPlistText(input.name, 'CFBundleName', 'gjsify.ship.name');
    const executable = assertPlistText(input.binaryName, 'CFBundleExecutable', 'gjsify.ship.binaryName');
    const appId = assertPlistText(input.appId, 'CFBundleIdentifier', 'gjsify.ship.appId');
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        // Alphabetical, because both cited files are: `macos-app-sandbox/Info.plist`
        // runs Executable → Identifier → InfoDictionaryVersion → Name → PackageType
        // → ShortVersionString → SupportedPlatforms → Version, and `v8/gni`'s
        // CFBundle keys sort the same way. Matching them keeps a diff against a
        // real bundle readable; no claim is made about what Xcode emits.
        //
        // `ATSApplicationFontsPath` sorts before every `CFBundle*` key, which is
        // where alphabetical order puts it and also where a reader looks for it.
        // Absent, not empty, when the bundle carries no face: an empty string is a
        // path, and macOS would activate the Resources directory itself.
        ...(fontsPath === undefined ? [] : [stringEntry('ATSApplicationFontsPath', fontsPath)]),
        stringEntry('CFBundleDevelopmentRegion', 'en'),
        stringEntry('CFBundleDisplayName', name),
        stringEntry('CFBundleExecutable', executable),
        stringEntry('CFBundleIdentifier', appId),
        stringEntry('CFBundleInfoDictionaryVersion', '6.0'),
        stringEntry('CFBundleName', name),
        stringEntry('CFBundlePackageType', PACKAGE_TYPE),
        stringEntry('CFBundleShortVersionString', input.version),
        stringEntry('CFBundleSignature', SIGNATURE),
        arrayEntry('CFBundleSupportedPlatforms', ['MacOSX']),
        stringEntry('CFBundleVersion', `${input.version}-${input.release}`),
        '</dict>',
        '</plist>',
        '',
    ].join('\n');
}

/**
 * Render `Contents/PkgInfo`: the package type and the signature, eight bytes, no
 * newline.
 *
 * `refs/node/tools/gyp/pylib/gyp/mac_tool.py:236-245` is the whole
 * specification — "eight characters, representing the bundle type and bundle
 * signature, each four characters" — and its
 * `fp.write(f"{package_type}{signature_code}")` writes no terminator. A trailing
 * newline would make the file nine bytes, which is the kind of difference
 * nothing complains about and every byte comparison notices.
 *
 * Redundant with `Info.plist` by design: it is the pre-plist Carbon record that
 * LaunchServices still reads, and gyp writes both from one source for exactly
 * the same reason this function takes none — both values are constants here.
 */
export function renderPkgInfo(): string {
    return `${PACKAGE_TYPE}${SIGNATURE}`;
}
