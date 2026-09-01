// Ionicons' names → the icon theme's symbolic names, and the refusal for the rest.
//
// THE IONICONS HALF IS DECLARED: `@expo/vector-icons` is not a dependency here, so there
// is no glyph map to read. A key that does not exist upstream is a dead row and costs
// nothing; a key that is MISSING is a named refusal that lists what is mapped, which is
// the failure mode worth having.
//
// THE GTK HALF IS CHECKED TWICE, and the two ask different questions — a distinction
// this file got wrong once and paid for:
//
//   * `scripts/check-rn-icon-targets.mjs` holds every target below against the icon set
//     this repository VENDORS (`packages/web/adwaita-icons`). It reads SOURCE, so it is
//     the same answer on every machine, and it is what catches a typo or a name too NEW
//     for the pinned set.
//   * `surfaces.spec.ts` additionally asks the INSTALLED theme through
//     `Gtk.IconTheme.has_icon`. That half is a claim about the RUNNER, and it is kept
//     because GTK draws `image-missing` for a name it cannot resolve and reports
//     nothing — a target resolving nowhere would put a broken-image glyph in a shipped
//     application.
//
// THE INCIDENT, because the sentence that stood here was the defect. It read "every
// TARGET held against the installed icon theme" — honest about the mechanism and blind
// to the consequence, since "the installed theme" is not the SAME theme in both
// environments. `checkmark-symbolic` exists on a current Fedora desktop
// (adwaita-icon-theme 50.0) and not in the CI container's, so a map measured on one
// machine went red on the other. Nothing was wrong with the mapping's SHAPE; the vector
// was a gate on one host's theme version. The vendored set is the authority that does not
// move, and it disagreed with that row too: 93 of the 94 targets were in it, and the 94th
// was the one CI rejected.
//
// WHY MANY IONICONS NAMES SHARE ONE ICON. `chevron-forward` and `arrow-forward` are
// both `go-next-symbolic`, because the icon theme draws the distinction a desktop
// makes rather than the one iOS does — a navigation arrow is one glyph here. Same for
// the filled/outline pairs: the Adwaita symbolic set is one weight, so `trash` and
// `trash-outline` are the same icon, and where the theme really does have both
// (`starred`/`non-starred`) the pair is kept.
//
// THE TABLE IS NOT IN L2, and that is deliberate. `primitives/table.ts`' `Icon` row
// takes an icon NAME as a plain string, so it stays reusable for the next glyph
// vocabulary (`MaterialIcons` is a second table, not new code). A per-vocabulary map
// inside the primitive table would make L2 hold a third-party library's spelling.

import { PrimitiveError } from '../primitives/errors.js';

/** Ionicons name → the icon theme's symbolic name. */
export const IONICONS: Readonly<Record<string, string>> = {
    home: 'go-home-symbolic',
    search: 'system-search-symbolic',
    settings: 'emblem-system-symbolic',
    'settings-outline': 'preferences-system-symbolic',
    close: 'window-close-symbolic',
    'close-circle': 'process-stop-symbolic',
    'chevron-forward': 'go-next-symbolic',
    'chevron-back': 'go-previous-symbolic',
    'chevron-up': 'go-up-symbolic',
    'chevron-down': 'go-down-symbolic',
    'caret-down': 'pan-down-symbolic',
    'caret-up': 'pan-up-symbolic',
    'caret-forward': 'pan-end-symbolic',
    'caret-back': 'pan-start-symbolic',
    'arrow-forward': 'go-next-symbolic',
    'arrow-back': 'go-previous-symbolic',
    'arrow-up': 'go-up-symbolic',
    'arrow-down': 'go-down-symbolic',
    add: 'list-add-symbolic',
    remove: 'list-remove-symbolic',
    play: 'media-playback-start-symbolic',
    pause: 'media-playback-pause-symbolic',
    stop: 'media-playback-stop-symbolic',
    'play-skip-forward': 'media-skip-forward-symbolic',
    'play-skip-back': 'media-skip-backward-symbolic',
    'play-forward': 'media-seek-forward-symbolic',
    'play-back': 'media-seek-backward-symbolic',
    heart: 'emote-love-symbolic',
    star: 'starred-symbolic',
    'star-outline': 'non-starred-symbolic',
    'share-outline': 'send-to-symbolic',
    trash: 'user-trash-symbolic',
    'trash-outline': 'user-trash-symbolic',
    // `object-select-symbolic` and NOT `checkmark-symbolic`: the latter exists on a
    // current desktop and NOT in the icon set this repository vendors — see the header.
    checkmark: 'object-select-symbolic',
    'checkmark-circle': 'object-select-symbolic',
    'information-circle': 'dialog-information-symbolic',
    'help-circle': 'help-about-symbolic',
    warning: 'dialog-warning-symbolic',
    alert: 'dialog-warning-symbolic',
    menu: 'open-menu-symbolic',
    person: 'avatar-default-symbolic',
    'person-circle': 'avatar-default-symbolic',
    people: 'system-users-symbolic',
    mail: 'mail-unread-symbolic',
    'mail-outline': 'mail-unread-symbolic',
    send: 'mail-send-symbolic',
    calendar: 'x-office-calendar-symbolic',
    'document-text': 'x-office-document-symbolic',
    document: 'text-x-generic-symbolic',
    image: 'image-x-generic-symbolic',
    camera: 'camera-photo-symbolic',
    videocam: 'camera-video-symbolic',
    mic: 'audio-input-microphone-symbolic',
    'mic-off': 'microphone-sensitivity-muted-symbolic',
    'volume-high': 'audio-volume-high-symbolic',
    'volume-medium': 'audio-volume-medium-symbolic',
    'volume-low': 'audio-volume-low-symbolic',
    'volume-mute': 'audio-volume-muted-symbolic',
    refresh: 'view-refresh-symbolic',
    sync: 'view-refresh-symbolic',
    download: 'folder-download-symbolic',
    'cloud-download': 'folder-download-symbolic',
    'cloud-upload': 'send-to-symbolic',
    link: 'insert-link-symbolic',
    'lock-closed': 'changes-prevent-symbolic',
    'lock-open': 'changes-allow-symbolic',
    eye: 'view-reveal-symbolic',
    'eye-off': 'view-conceal-symbolic',
    list: 'view-list-symbolic',
    grid: 'view-grid-symbolic',
    notifications: 'preferences-system-notifications-symbolic',
    bookmark: 'user-bookmarks-symbolic',
    'ellipsis-horizontal': 'view-more-symbolic',
    'ellipsis-vertical': 'view-more-symbolic',
    time: 'preferences-system-time-symbolic',
    globe: 'network-workgroup-symbolic',
    earth: 'network-workgroup-symbolic',
    location: 'mark-location-symbolic',
    navigate: 'find-location-symbolic',
    call: 'call-start-symbolic',
    chatbubble: 'user-available-symbolic',
    'log-out': 'system-log-out-symbolic',
    'log-in': 'system-users-symbolic',
    expand: 'view-fullscreen-symbolic',
    contract: 'view-restore-symbolic',
    sunny: 'weather-clear-symbolic',
    moon: 'weather-clear-night-symbolic',
    wifi: 'network-wireless-signal-excellent-symbolic',
    'battery-full': 'battery-full-symbolic',
    print: 'printer-symbolic',
    open: 'document-open-symbolic',
    pencil: 'document-edit-symbolic',
    copy: 'edit-copy-symbolic',
    save: 'document-save-symbolic',
    folder: 'folder-symbolic',
    'folder-open': 'folder-open-symbolic',
    'musical-notes': 'audio-x-generic-symbolic',
    headset: 'audio-headphones-symbolic',
    film: 'video-x-generic-symbolic',
    'swap-vertical': 'view-sort-descending-symbolic',
    terminal: 'utilities-terminal-symbolic',
    'radio-button-on': 'radio-checked-symbolic',
    'radio-button-off': 'radio-symbolic',
    square: 'checkbox-symbolic',
    'checkbox-outline': 'checkbox-symbolic',
    options: 'view-more-horizontal-symbolic',
    'color-palette': 'preferences-desktop-appearance-symbolic',
    power: 'system-shutdown-symbolic',
    ban: 'action-unavailable-symbolic',
    exit: 'system-log-out-symbolic',
};

/** Every Ionicons name this layer answers for. Read by the spec and by the refusal. */
export const IONICONS_NAMES: readonly string[] = Object.keys(IONICONS);

/** Every symbolic name the map targets, deduplicated — what the spec asks the theme about. */
export const IONICONS_TARGETS: readonly string[] = [...new Set(Object.values(IONICONS))];

/**
 * The icon-theme name for an Ionicons name, or a named refusal.
 *
 * The refusal lists what IS mapped, which is long and is the point: GTK's answer to an
 * unknown icon name is `image-missing`, drawn silently, so the alternative to this
 * message is a broken-image glyph nobody notices until a screenshot.
 */
export function ioniconName(name: unknown): string {
    if (typeof name !== 'string') {
        throw new PrimitiveError(
            'Ionicons',
            'name',
            `takes an Ionicons name, and received ${name === null ? 'null' : typeof name}`,
        );
    }
    const mapped = IONICONS[name];
    if (mapped !== undefined) return mapped;
    throw new PrimitiveError(
        'Ionicons',
        `name="${name}"`,
        `has no icon in the theme’s vocabulary. A GTK icon is addressed by NAME and GTK draws ` +
            `\`image-missing\` for one it does not have, silently — so an unmapped name is a refusal rather ` +
            `than a glyph nobody notices. Mapped: ${IONICONS_NAMES.join(', ')}. Add a row to ` +
            `\`surfaces/icon-map.ts\` if the theme has a counterpart, or render \`<Icon name="…-symbolic">\` ` +
            `with the theme’s own name`,
    );
}
