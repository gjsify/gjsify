import { describe, expect, it } from '@gjsify/unit';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { applyAutostartFile, autostartFilePath } from './autostart-file.js';
import { OWNER_MARKER_KEY } from './desktop-entry.js';

const APP = 'org.example.App';

function read(path: string): string | null {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) return null;
    const [, contents] = file.load_contents(null);
    return new TextDecoder().decode(contents);
}

function request(configDir: string, autostart: boolean) {
    return { appId: APP, name: 'Example', commandline: ['/usr/bin/app', '--tray'], autostart, configDir };
}

export default async () => {
    await describe('autostart file driver', async () => {
        await it('writes a marked file under autostart/ and removes it again', async () => {
            const dir = GLib.dir_make_tmp('xdp-file-XXXXXX');
            applyAutostartFile(request(dir, true));
            const text = read(autostartFilePath(dir, APP));
            expect(text?.includes(`${OWNER_MARKER_KEY}=true`)).toBe(true);
            expect(text?.includes('Exec=/usr/bin/app --tray')).toBe(true);
            applyAutostartFile(request(dir, false));
            expect(read(autostartFilePath(dir, APP))).toBe(null);
        });
        await it('leaves a foreign file untouched in both directions', async () => {
            const dir = GLib.dir_make_tmp('xdp-file-XXXXXX');
            const path = autostartFilePath(dir, APP);
            GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
            const foreign = '[Desktop Entry]\nName=Mine\nExec=other\n';
            GLib.file_set_contents(path, foreign);
            applyAutostartFile(request(dir, true));
            expect(read(path)).toBe(foreign);
            applyAutostartFile(request(dir, false));
            expect(read(path)).toBe(foreign);
        });
        await it('treats removing a missing entry as done', async () => {
            const dir = GLib.dir_make_tmp('xdp-file-XXXXXX');
            applyAutostartFile(request(dir, false));
            expect(read(autostartFilePath(dir, APP))).toBe(null);
        });
        await it('rewrites its own file with the new command line', async () => {
            const dir = GLib.dir_make_tmp('xdp-file-XXXXXX');
            applyAutostartFile(request(dir, true));
            applyAutostartFile({ ...request(dir, true), commandline: ['/usr/bin/other'] });
            expect(read(autostartFilePath(dir, APP))?.includes('Exec=/usr/bin/other')).toBe(true);
        });
    });
};
