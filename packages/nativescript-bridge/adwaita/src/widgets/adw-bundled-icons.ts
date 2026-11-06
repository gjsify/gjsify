// Glyphs libadwaita ships as its own resources, which are not part of the Adwaita icon theme and
// so are not in `COMPILED_ICONS`. They are SVG sources, the door `iconValueKind` keeps open.

/**
 * `adw-external-link`, the suffix of every link row in `AdwAboutDialog`.
 *
 * libadwaita's source draws it as a 2px stroke; the rasteriser here fills paths, so this is the
 * same outline (a box open at the top right and an arrow leaving it) as a filled shape.
 */
export const EXTERNAL_LINK_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
    '<path d="M10 1H15V6L13.2 4.2L8.7 8.7L7.3 7.3L11.8 2.8Z"/>' +
    '<path d="M7 3V5H3V13H11V9H13V13A2 2 0 0 1 11 15H3A2 2 0 0 1 1 13V5A2 2 0 0 1 3 3Z"/>' +
    '</svg>';
