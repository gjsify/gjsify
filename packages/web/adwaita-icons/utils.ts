// Utility helpers for using Adwaita icon SVG strings in CSS.
// Reference: refs/adwaita-icon-theme. Copyright (c) GNOME contributors, LGPL-3.0+/CC-BY-SA-3.0.

/**
 * Encode an SVG string as a CSS `url(...)` data-URI for use in
 * `mask-image`, `background-image`, or similar CSS properties.
 *
 * Normalizes whitespace (collapses to single spaces), replaces
 * double quotes with single quotes, then percent-encodes via
 * `encodeURIComponent` for maximum browser compatibility.
 */
export function toDataUri(svg: string): string {
    // Collapse all whitespace (incl. newlines) to single spaces
    let s = svg.replace(/\s+/g, ' ').trim();
    // Use single quotes for SVG attributes — avoids %22 inside url("...")
    s = s.replace(/"/g, "'");
    return `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
}
