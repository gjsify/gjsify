// @gjsify/adwaita-app — resolveIconDir tests.
// Runs on GJS + Node (pure logic, injected env and filesystem).

import { describe, expect, it } from '@gjsify/unit';
import { ICON_DIR_SEARCH_DEPTH, bundleDirFromUrl, resolveIconDir } from './app-icon-dir.js';

const existing =
    (...dirs: string[]) =>
    (path: string) =>
        dirs.includes(path);

export default async () => {
    await describe('resolveIconDir', async () => {
        await it('prefers the option over the environment and the search', () => {
            const dir = resolveIconDir({
                iconDir: '/opt/a/icons',
                env: { GJSIFY_ICON_DIR: '/env/icons' },
                startDir: '/repo/dist',
                isDirectory: existing('/repo/data/icons'),
            });
            expect(dir).toBe('/opt/a/icons');
        });

        await it('reads GJSIFY_ICON_DIR before searching', () => {
            const dir = resolveIconDir({
                env: { GJSIFY_ICON_DIR: '/env/icons' },
                startDir: '/repo/dist',
                isDirectory: existing('/repo/data/icons'),
            });
            expect(dir).toBe('/env/icons');
        });

        // `add_search_path('')` would add the current directory.
        await it('treats an empty or blank value as unset', () => {
            const isDirectory = existing('/repo/data/icons');
            expect(
                resolveIconDir({ iconDir: '', env: { GJSIFY_ICON_DIR: '  ' }, startDir: '/repo/dist', isDirectory }),
            ).toBe('/repo/data/icons');
        });

        await it('finds data/icons above the bundle, at any depth up to the bound', () => {
            const isDirectory = existing('/repo/data/icons');
            expect(resolveIconDir({ startDir: '/repo/dist', isDirectory })).toBe('/repo/data/icons');
            expect(resolveIconDir({ startDir: '/repo/dist/app', isDirectory })).toBe('/repo/data/icons');
            expect(resolveIconDir({ startDir: '/repo/src/frontends/desktop', isDirectory })).toBe('/repo/data/icons');
        });

        await it('takes the nearest data/icons', () => {
            const isDirectory = existing('/repo/data/icons', '/repo/dist/data/icons');
            expect(resolveIconDir({ startDir: '/repo/dist', isDirectory })).toBe('/repo/dist/data/icons');
        });

        await it('gives up past the search depth', () => {
            const deep = `/repo${'/x'.repeat(ICON_DIR_SEARCH_DEPTH)}`;
            expect(resolveIconDir({ startDir: deep, isDirectory: existing('/repo/data/icons') })).toBe(undefined);
        });

        await it('reaches the filesystem root without looping', () => {
            expect(resolveIconDir({ startDir: '/a', isDirectory: existing('/data/icons') })).toBe('/data/icons');
            expect(resolveIconDir({ startDir: '/a', isDirectory: existing() })).toBe(undefined);
        });

        await it('answers undefined with nothing to go on', () => {
            expect(resolveIconDir()).toBe(undefined);
            expect(resolveIconDir({ startDir: '/repo' })).toBe(undefined);
        });
    });

    await describe('bundleDirFromUrl', async () => {
        await it('returns the directory of a file: URL', () => {
            expect(bundleDirFromUrl('file:///repo/dist/app.gjs.mjs')).toBe('/repo/dist');
            expect(bundleDirFromUrl('file:///app.gjs.mjs')).toBe('/');
            expect(bundleDirFromUrl('file:///my%20repo/dist/a.mjs')).toBe('/my repo/dist');
        });

        await it('skips anything that is not a file: URL', () => {
            expect(bundleDirFromUrl('resource:///org/x/app.js')).toBe(undefined);
            expect(bundleDirFromUrl('https://example.org/a.js')).toBe(undefined);
            expect(bundleDirFromUrl(undefined)).toBe(undefined);
        });
    });
};
