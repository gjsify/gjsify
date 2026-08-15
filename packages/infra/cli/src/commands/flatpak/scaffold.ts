// Flathub-specific scaffolding for `gjsify flatpak init`, plus the thin adapter
// that hands `gjsify.flatpak`'s metadata half to the shared renderers.
//
// The MetaInfo XML and the `.desktop` entry moved to `utils/app-metadata.ts`
// (ADR 0024 § 8): they describe the APP, not the Flatpak, and `gjsify ship`
// stages the same two files into `share/metainfo/` and `share/applications/`.
// What stays here is genuinely Flathub's — `flathub.json`, a policy file no
// other format has.

import { readFileSync } from 'node:fs';
import type { ConfigDataFlatpak } from '../../types/config-data.js';
import {
    type AppMetadataInputs,
    type MissingFieldError,
    renderDesktopEntry,
    renderMetainfoApp as renderMetainfoAppShared,
    renderMetainfoCli as renderMetainfoCliShared,
    validateAppMetadata,
} from '../../utils/app-metadata.js';

export type { MissingFieldError };

/**
 * Lazy template loaders. `static-read-inliner` matches this shape and inlines
 * the templates into the GJS bundle at build time.
 */
function loadFlathubAppTemplate(): string {
    return readFileSync(new URL('../../templates/flatpak/flathub-app.json.tmpl', import.meta.url), 'utf-8');
}
function loadFlathubCliTemplate(): string {
    return readFileSync(new URL('../../templates/flatpak/flathub-cli.json.tmpl', import.meta.url), 'utf-8');
}

export interface ScaffoldInputs {
    appId: string;
    name: string;
    command: string;
    kind: 'app' | 'cli';
    flatpak: ConfigDataFlatpak;
}

/** `gjsify.flatpak` IS an `AppMetadata` plus Flatpak's own keys. */
function toMetadataInputs(inputs: ScaffoldInputs): AppMetadataInputs {
    return {
        appId: inputs.appId,
        name: inputs.name,
        command: inputs.command,
        kind: inputs.kind,
        metadata: inputs.flatpak,
        configKey: 'gjsify.flatpak',
    };
}

/**
 * Validate that the config has the minimum set of fields required for
 * MetaInfo XML rendering. Returns the list of missing fields with
 * actionable hints; empty list means OK.
 */
export function validateScaffoldInputs(inputs: ScaffoldInputs): MissingFieldError[] {
    return validateAppMetadata(toMetadataInputs(inputs));
}

/** Render the MetaInfo XML for a desktop application. */
export function renderMetainfoApp(inputs: ScaffoldInputs): string {
    return renderMetainfoAppShared(toMetadataInputs(inputs));
}

/** Render the MetaInfo XML for a console application. */
export function renderMetainfoCli(inputs: ScaffoldInputs): string {
    return renderMetainfoCliShared(toMetadataInputs(inputs));
}

/** Render the .desktop entry (app kind only). */
export function renderDesktop(inputs: ScaffoldInputs): string {
    return renderDesktopEntry(toMetadataInputs(inputs));
}

/** Render the flathub.json policy file. */
export function renderFlathubJson(kind: 'app' | 'cli'): string {
    return kind === 'cli' ? loadFlathubCliTemplate() : loadFlathubAppTemplate();
}
