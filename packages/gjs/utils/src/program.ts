import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
// `@gjsify/utils/program` — the part of the old `path.ts` that needs the GJS-only `system`
// built-in. Kept off the root barrel: NativeScript cannot resolve `system`, and `@gjsify/os` /
// `@gjsify/module` (aliased there) import the root.
// The bare `system` built-in, not `imports.system` — resolves on gjs AND the
// `--app node` reverse bridge (AGENTS.md § The legacy imports.* object is NOT
// an API).
import system from 'system';
const { File } = Gio;

const _getProgramDir = (programFile: Gio.File) => {
    const info = programFile.query_info('standard::', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);

    if (info.get_is_symlink()) {
        const symlinkFile = programFile.get_parent().resolve_relative_path(info.get_symlink_target());
        return symlinkFile.get_parent();
    } else {
        return programFile.get_parent();
    }
};

export const getProgramExe = () => {
    const currentDir = GLib.get_current_dir();
    return File.new_for_path(currentDir).resolve_relative_path(system.programInvocationName);
};

export const getProgramDir = () => {
    return _getProgramDir(getProgramExe()).get_path();
};

export const getNodeModulesPath = () => {
    let dir = File.new_for_path(getProgramDir());
    let found = false;

    do {
        dir = dir.resolve_relative_path('..');
        const nodeModulesDir = dir.resolve_relative_path('node_modules');
        found = nodeModulesDir.query_exists(null);
        if (found) {
            dir = nodeModulesDir;
        }
    } while (dir.has_parent(null) && !found);

    return dir;
};
