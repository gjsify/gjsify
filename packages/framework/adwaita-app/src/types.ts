// @gjsify/adwaita-app — shared, platform-neutral type declarations.
// Pure types only (no @girs value imports) so the pure-logic modules that
// consume them stay Node + GJS testable.

/** A single entry in the navigation sidebar / view stack. */
export interface NavItem {
    /** Stable id used as the `Gtk.Stack` child name and for `selectById`. */
    id: string;
    /** Sidebar row label. */
    label: string;
    /** Optional symbolic icon name for the sidebar row. */
    icon?: string;
    /** Optional dim caption under the label. */
    subtitle?: string;
}

/**
 * Fields for the standard `app.about` dialog. All optional except the name;
 * omitted fields are simply not set on the `Adw.AboutDialog`.
 */
export interface AboutInfo {
    /** Application name shown at the top of the dialog. */
    applicationName: string;
    /** Version string (e.g. `1.2.0`). */
    version?: string;
    /** "Developer" / vendor line. */
    developerName?: string;
    /** Icon name; defaults to the application id. */
    applicationIcon?: string;
    /** Homepage URL. */
    website?: string;
    /** Issue-tracker URL. */
    issueUrl?: string;
    /** License text or SPDX id (free-form, shown verbatim). */
    license?: string;
    /** Developer credit lines. */
    developers?: string[];
    /** Copyright line. */
    copyright?: string;
    /** Extra description shown under the header. */
    comments?: string;
}
