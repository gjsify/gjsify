// A hand-written AppStream metainfo that `gjsify ship` stages verbatim (ADR 0151).
//
// Apps that keep the file by hand — already translated, with screenshots and releases —
// name it in `gjsify.ship.metainfo` (or, as a fallback, `gjsify.site.metainfo`, which
// `gjsify site` and `gjsify release-notes` already read). `ship` then stages THAT file
// instead of rendering one from config, so the shipped component and the website cannot drift.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanXml } from '@gjsify/utils/core';

export interface HandMetainfo {
    /** The path as the project wrote it, for messages. */
    path: string;
    /** The file's bytes as UTF-8 — staged unchanged. */
    xml: string;
    /** `ship.metainfo` or the `site.metainfo` fallback — for messages. */
    key: 'gjsify.ship.metainfo' | 'gjsify.site.metainfo';
}

export interface HandMetainfoInputs {
    shipMetainfo?: string;
    siteMetainfo?: string;
    /** `gjsify.ship.releases` — a second source of the same `<releases>` block. */
    configReleases?: readonly unknown[];
    projectDir: string;
}

/**
 * Which hand file, if any, replaces the rendered metainfo.
 *
 * `ship.metainfo` is an explicit request, so a missing file or a conflicting `releases` in the
 * config REFUSES — merging would silently pick one. `site.metainfo` is only a fallback: a project
 * that already declares `ship.releases` keeps today's rendering rather than changing behaviour
 * under it.
 */
export function resolveHandMetainfo(input: HandMetainfoInputs): HandMetainfo | undefined {
    const hasReleases = (input.configReleases?.length ?? 0) > 0;
    let key: HandMetainfo['key'];
    let path: string;
    if (input.shipMetainfo !== undefined) {
        key = 'gjsify.ship.metainfo';
        path = input.shipMetainfo;
        if (hasReleases) {
            throw new Error(
                `gjsify ship: \`gjsify.ship.metainfo\` and \`gjsify.ship.releases\` both describe the releases. ` +
                    `The file is staged verbatim, so the config entries would be dropped without a word — ` +
                    `keep the \`<releases>\` in ${path} and remove \`releases\` from the config.`,
            );
        }
    } else if (input.siteMetainfo !== undefined && !hasReleases) {
        key = 'gjsify.site.metainfo';
        path = input.siteMetainfo;
    } else {
        return undefined;
    }
    const abs = resolve(input.projectDir, path);
    if (!existsSync(abs)) {
        throw new Error(`gjsify ship: \`${key}\` points at ${path}, which does not exist (${abs}).`);
    }
    return { path, xml: readFileSync(abs, 'utf-8'), key };
}

interface Facts {
    id?: string;
    launchable?: string;
    releaseVersions: string[];
}

function readFacts(xml: string): Facts {
    const facts: Facts = { releaseVersions: [] };
    const stack: string[] = [];
    let text = '';
    for (const token of scanXml(xml)) {
        if (token.kind === 'open') {
            const name = token.name;
            if (name === 'release' && token.attributes.version !== undefined) {
                facts.releaseVersions.push(token.attributes.version);
            }
            if (name === 'launchable' && token.attributes.type === 'desktop-id' && !token.selfClosing) {
                stack.push('launchable');
                text = '';
            } else if (name === 'id' && stack.length === 0 && facts.id === undefined && !token.selfClosing) {
                stack.push('id');
                text = '';
            }
        } else if (token.kind === 'text') {
            if (stack.length > 0) text += token.text;
        } else if (stack.length > 0) {
            const open = stack.pop();
            if (open === 'id') facts.id = text.trim();
            else if (open === 'launchable') facts.launchable = text.trim();
        }
    }
    return facts;
}

/**
 * Refuse a hand file that would ship as a different component than the package is.
 *
 * - `<id>` ≠ `appId`: the stage names the file `<appId>.metainfo.xml`, and every store resolves
 *   the component by the `<id>` INSIDE it — a mismatch installs and is invisible.
 * - `<launchable type="desktop-id">` ≠ `<appId>.desktop`: the desktop entry is still rendered
 *   from config under that name; a launchable pointing elsewhere gives Software a Launch button
 *   that finds nothing. An absent launchable is left to `lintMetainfo`, which warns.
 *
 * Returns warnings (the file lacks the package version) rather than throwing on them: the
 * release entry is usually added by the release step, which may run after `ship`.
 */
export function checkHandMetainfo(
    hand: HandMetainfo,
    expect: { appId: string; kind: 'app' | 'cli'; version: string },
): string[] {
    const facts = readFacts(hand.xml);
    if (facts.id !== expect.appId) {
        throw new Error(
            `gjsify ship: ${hand.path} (\`${hand.key}\`) has <id>${facts.id ?? ''}</id>, but the package's ` +
                `application id is "${expect.appId}" (\`gjsify.ship.appId\`). Stores resolve the component by the ` +
                `<id> inside the file, so one of the two is wrong.`,
        );
    }
    if (expect.kind === 'app' && facts.launchable !== undefined && facts.launchable !== `${expect.appId}.desktop`) {
        throw new Error(
            `gjsify ship: ${hand.path} (\`${hand.key}\`) has <launchable type="desktop-id">${facts.launchable}` +
                `</launchable>, but \`ship\` stages the desktop entry as ${expect.appId}.desktop.`,
        );
    }
    const warnings: string[] = [];
    if (!facts.releaseVersions.includes(expect.version)) {
        warnings.push(
            `${hand.path} has no <release version="${expect.version}"> — the shipped component will not list ` +
                `the version it is packaged as.`,
        );
    }
    return warnings;
}
