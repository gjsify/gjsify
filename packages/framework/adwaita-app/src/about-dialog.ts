// An `Adw.AboutDialog` built from the application's own AppStream metainfo — on all three
// platforms, including the one whose libadwaita cannot do it.
//
// THE INCIDENT. `Adw.AboutDialog.new_from_appdata()` is ABSENT from the win32 GTK runtime
// bundle. gvsbuild applies `patches/libadwaita/0001-remove-appstream-dependency.patch`, which
// wraps every `*_from_appdata` entry point in `#ifndef G_OS_WIN32` and makes `appstream_dep`
// conditional on `target_system != 'windows'`: libadwaita 1.9.x parses AppStream through the
// heavyweight `appstream` library, and gvsbuild defines no project for it. Homebrew's formula
// `depends_on "appstream"`, so BOTH darwin bundles have the constructor and win32-x64 does
// not — measured symbol by symbol out of each published bundle's own `Adw-1.typelib`
// (gjsify/gjsify#1662; the gap is recorded in `packages/node-gi/scripts/typelib-symbols.mjs`
// and expires when a gvsbuild pin lets the patch go, at libadwaita >= 1.10 / ministream).
//
// On Windows 11 the ordinary call site reads `no static method 'new_from_appdata'` at the
// moment the user opens the dialog, and the About dialog does not open at all. Nothing in
// this repository can compile that symbol, so this is the other half of the answer: the same
// dialog, assembled from the same metainfo, by `appdata.ts` — which ports ministream's
// selection rules so the two platforms agree on what the document says.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { type AppdataFields, appdataLocale, parseAppdata } from './appdata.js';

/**
 * SPDX id → `Gtk.License`, transcribed from libadwaita's `gtk_license_info` table (itself
 * copied from GTK for consistency with `GtkAboutDialog`) plus its two deprecated aliases.
 *
 * All nineteen, not the handful an application happens to use: an id this table misses
 * becomes `Gtk.License.CUSTOM`, and a CUSTOM licence with no licence text is a legal page
 * that says nothing. The consequence would be Windows-only, on somebody else's app.
 */
const LICENSE_TYPES: Record<string, Gtk.License> = {
    'GPL-2.0-or-later': Gtk.License.GPL_2_0,
    'GPL-3.0-or-later': Gtk.License.GPL_3_0,
    'LGPL-2.1-or-later': Gtk.License.LGPL_2_1,
    'LGPL-3.0-or-later': Gtk.License.LGPL_3_0,
    'BSD-2-Clause': Gtk.License.BSD,
    MIT: Gtk.License.MIT_X11,
    'Artistic-2.0': Gtk.License.ARTISTIC,
    'GPL-2.0-only': Gtk.License.GPL_2_0_ONLY,
    'GPL-3.0-only': Gtk.License.GPL_3_0_ONLY,
    'LGPL-2.1-only': Gtk.License.LGPL_2_1_ONLY,
    'LGPL-3.0-only': Gtk.License.LGPL_3_0_ONLY,
    'AGPL-3.0-or-later': Gtk.License.AGPL_3_0,
    'AGPL-3.0-only': Gtk.License.AGPL_3_0_ONLY,
    'BSD-3-Clause': Gtk.License.BSD_3,
    'Apache-2.0': Gtk.License.APACHE_2_0,
    'MPL-2.0': Gtk.License.MPL_2_0,
    '0BSD': Gtk.License['0BSD'],
    // Deprecated SPDX ids libadwaita still maps, because metainfo files in the wild use them.
    'GPL-2.0': Gtk.License.GPL_2_0_ONLY,
    'GPL-3.0': Gtk.License.GPL_3_0_ONLY,
};

/**
 * The `Gtk.License` an SPDX id names, or `Gtk.License.CUSTOM` for one GTK does not know.
 *
 * CUSTOM is returned WITHOUT also setting a licence text, which is what upstream does. Putting
 * the raw SPDX id in `Adw.AboutDialog:license` instead would be more informative and would
 * therefore show a licence line on Windows that Linux does not show — the divergence this
 * whole module exists to prevent.
 */
export function licenseTypeFor(spdxId: string): Gtk.License {
    return LICENSE_TYPES[spdxId] ?? Gtk.License.CUSTOM;
}

/**
 * Whether this GTK runtime has `Adw.AboutDialog.new_from_appdata()`.
 *
 * Asked as a QUESTION rather than discovered by calling and catching, for two reasons. A
 * `try` around the call would also swallow a genuine failure — a metainfo file the parser
 * rejects would silently become "the constructor is missing" and the app would ship a
 * quietly degraded dialog forever. And it would not work anyway: libadwaita reports an
 * unreadable or unparseable resource with `g_error()`, which ABORTS the process, and no
 * catch runs after that.
 *
 * The `try` that IS here wraps the LOOKUP, because the absence has two shapes and only one
 * of them is a plain `undefined`: node-gi reports an entry point missing from the typelib by
 * throwing `no static method 'new_from_appdata'` at property access, which is exactly how the
 * Windows 11 measurement in #1662 reads.
 *
 * `namespace` defaults to the real `Adw` and is a parameter so both shapes can be held
 * against the real question on a platform that has neither. It substitutes a namespace and
 * never means "no namespace": passing `undefined` is the default parameter and therefore asks
 * about `Adw`.
 */
export function hasAppdataConstructor(namespace: unknown = Adw): boolean {
    try {
        const dialog = (namespace as { AboutDialog?: Record<string, unknown> } | undefined)?.AboutDialog;
        return typeof dialog?.new_from_appdata === 'function';
    } catch {
        return false;
    }
}

/** Where {@link createAboutDialog} may read the metainfo document from. */
export interface AppdataSource {
    /**
     * GResource path of the metainfo file, e.g.
     * `/org/example/App/metainfo/org.example.App.metainfo.xml`.
     *
     * This is the only form the upstream constructor accepts, so an app that registers its
     * metainfo as a resource takes the upstream path wherever it exists.
     */
    appdataResource?: string;
    /**
     * Filesystem path of the metainfo file, consulted when no resource answers.
     *
     * Upstream has no equivalent — and that is the point. A `gjsify ship` artifact may carry
     * the metainfo beside the bundle rather than inside a GResource (a `.app` is dragged
     * wherever the user likes, a Windows program directory is unzipped to an arbitrary path),
     * and such an app would otherwise have no About dialog on ANY platform. Where the
     * directory is remains the caller's question: this module takes a path, exactly as
     * `locale-dir.ts` takes a directory rather than going looking for one.
     */
    appdataPath?: string;
}

/** Options for {@link createAboutDialog}. */
export interface CreateAboutDialogOptions extends AppdataSource {
    /**
     * Show the release notes of this exact version, matched by string equality — the second
     * argument of `Adw.AboutDialog.new_from_appdata()`, with the same semantics.
     */
    releaseNotesVersion?: string;
    /**
     * Version shown in the dialog, overriding the metainfo's newest release.
     *
     * Worth passing. The metainfo answers this question only as well as it is maintained,
     * and it is the one field where this module's reading and ministream's can disagree —
     * ministream sorts releases by a dpkg-style version comparison, `appdata.ts` takes the
     * first one written. An explicit version removes the question on every platform at once.
     */
    version?: string;
    /** Icon name, overriding the one derived from `<id>`. */
    applicationIcon?: string;
    /**
     * Build the dialog from parsed AppStream even where the upstream constructor exists.
     *
     * Not a test hook — or not only one. The parsed path is what every Windows user sees and
     * what NO Linux or macOS run would otherwise execute, so a developer who wants to check
     * their About dialog before shipping has no other way to look at it. The suite beside
     * this file uses it for the same reason.
     */
    forceParsedAppdata?: boolean;
}

/**
 * Set on `dialog` exactly what `populate_from_appdata` sets, and nothing else.
 *
 * The upstream list, read off `adw-about-dialog.c` rather than guessed: application icon
 * (from `<id>`), application name, developer name, version, website, support url, issue url,
 * licence TYPE, and the release notes of one named release. It sets no `comments`, no
 * `copyright`, no `translator-credits` and no `developers` — AppStream's `<summary>` is not
 * `Adw.AboutDialog:comments` and upstream never treats it as one — so neither does this.
 * An app that wants those sets them on the returned dialog itself.
 */
export function applyAppdataFields(
    dialog: Adw.AboutDialog,
    fields: AppdataFields,
    releaseNotesVersion?: string,
): Adw.AboutDialog {
    if (fields.applicationId !== null) dialog.applicationIcon = fields.applicationId;
    if (fields.applicationName !== null) dialog.applicationName = fields.applicationName;
    if (fields.developerName !== null) dialog.developerName = fields.developerName;
    if (fields.website !== null) dialog.website = fields.website;
    if (fields.supportUrl !== null) dialog.supportUrl = fields.supportUrl;
    if (fields.issueUrl !== null) dialog.issueUrl = fields.issueUrl;
    if (fields.license !== null) dialog.licenseType = licenseTypeFor(fields.license);
    // BEFORE the notes: the "What's new" page takes its heading from this property and falls
    // back to `version` only when it is empty, and libadwaita renders the heading when the
    // notes are set. Upstream gets the order for free — both are construct properties.
    if (releaseNotesVersion !== undefined && releaseNotesVersion !== '') {
        dialog.releaseNotesVersion = releaseNotesVersion;
    }
    if (fields.releaseNotes !== null) dialog.releaseNotes = fields.releaseNotes;
    if (fields.version !== null) dialog.version = fields.version;
    return dialog;
}

/**
 * Build the dialog from a metainfo document, without consulting libadwaita's constructor.
 *
 * This is the Windows path, exported so it is callable on a platform that has the constructor:
 * a fallback only one OS can reach is a fallback no suite covers, and the class of defect that
 * hides there is a restructured metainfo file that empties the About dialog on Windows while
 * every Linux run stays green.
 */
export function buildAboutDialogFromAppdata(
    xml: string,
    options: { releaseNotesVersion?: string; locale?: string } = {},
): Adw.AboutDialog {
    const fields = parseAppdata(xml, {
        locale: options.locale ?? appdataLocale(GLib.get_language_names(), { LANG: GLib.getenv('LANG') ?? undefined }),
        releaseNotesVersion: options.releaseNotesVersion,
    });
    return applyAppdataFields(new Adw.AboutDialog(), fields, options.releaseNotesVersion);
}

/** Whether a GResource path resolves, without paying to decode the file. */
function resourceExists(path: string): boolean {
    try {
        Gio.resources_get_info(path, Gio.ResourceLookupFlags.NONE);
        return true;
    } catch {
        // A GError, and the only answer it can give: the resource is not registered.
        return false;
    }
}

function readResource(path: string): string | null {
    try {
        const bytes = Gio.resources_lookup_data(path, Gio.ResourceLookupFlags.NONE);
        return new TextDecoder().decode(bytes.toArray());
    } catch {
        return null;
    }
}

function readFile(path: string): string | null {
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(contents) : null;
    } catch {
        // `g_file_get_contents` is `throws`: a missing or unreadable file arrives here, and
        // a missing one is an ordinary state — the resource may well have answered instead.
        return null;
    }
}

/** Said once per process, not once per dialog: the cause does not change while it runs. */
let saidFallback = false;

/**
 * Create an `Adw.AboutDialog` from the application's AppStream metainfo.
 *
 * A drop-in for `Adw.AboutDialog.new_from_appdata(resource, version)` that works on Windows:
 *
 * ```ts
 * const dialog = createAboutDialog({
 *     appdataResource: '/org/example/App/metainfo/org.example.App.metainfo.xml',
 *     releaseNotesVersion: PACKAGE_VERSION,
 *     version: PACKAGE_VERSION,
 * });
 * dialog.present(window);
 * ```
 *
 * THE RESOURCE IS CHECKED BEFORE THE CONSTRUCTOR IS CALLED, and that is not a tidiness step.
 * `populate_from_appdata` reports a resource it cannot read with `g_error()`, which aborts the
 * process — a typo in a resource path would kill the application when the user opens About,
 * with no exception for anyone to catch. Asking `Gio.resources_get_info` first turns that into
 * a dialog assembled from whatever source did answer.
 */
export function createAboutDialog(options: CreateAboutDialogOptions = {}): Adw.AboutDialog {
    const { appdataResource, appdataPath, releaseNotesVersion } = options;
    const resourceReadable = appdataResource !== undefined && resourceExists(appdataResource);

    let dialog: Adw.AboutDialog;
    if (!options.forceParsedAppdata && resourceReadable && hasAppdataConstructor()) {
        dialog = Adw.AboutDialog.new_from_appdata(
            appdataResource as string,
            releaseNotesVersion ?? '',
        ) as unknown as Adw.AboutDialog;
    } else {
        // Resource first even here: it is the same bytes the upstream constructor would have
        // read, so the two platforms cannot end up reading two different documents.
        const xml =
            (resourceReadable ? readResource(appdataResource as string) : null) ??
            (appdataPath !== undefined ? readFile(appdataPath) : null);
        if (xml === null) {
            // Name what was wanted and where it was looked for. A bare empty dialog is the
            // one outcome nobody can diagnose from the dialog itself.
            console.error(
                '@gjsify/adwaita-app: no AppStream metainfo found for the About dialog; looked at ' +
                    `resource ${appdataResource ?? '(none given)'} and file ${appdataPath ?? '(none given)'}`,
            );
            dialog = new Adw.AboutDialog();
        } else {
            if (!saidFallback && !options.forceParsedAppdata && resourceReadable) {
                saidFallback = true;
                // console.log, not console.debug: GJS drops the debug level even under
                // G_MESSAGES_DEBUG=all, so the one line explaining which code drew this
                // dialog would never reach whoever is reading the log.
                console.log(
                    '@gjsify/adwaita-app: Adw.AboutDialog.new_from_appdata is not in this GTK ' +
                        'runtime (expected on Windows — gjsify/gjsify#1662); building the About ' +
                        'dialog from the AppStream metainfo directly.',
                );
            }
            dialog = buildAboutDialogFromAppdata(xml, { releaseNotesVersion });
        }
    }

    // Applied to BOTH branches, or the same options would mean different things per platform.
    if (options.applicationIcon !== undefined) dialog.applicationIcon = options.applicationIcon;
    if (options.version !== undefined) dialog.version = options.version;
    return dialog;
}
