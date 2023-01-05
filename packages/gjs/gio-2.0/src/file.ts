import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

export class ExtFile extends Gio.File {

    /**
     * Creates a new instance of `ExtFile` extended on a existing `Gio.File` instance.
     * @param file The original unextended `Gio.File`
     * @returns The Gio.File` extended to `ExtFile`
     */
    static extend(file: Gio.File) {
        const extFile = file as Gio.File & ExtFile;
        extFile.makeSymbolicLinkAsync = ExtFile.prototype.makeSymbolicLinkAsync.bind(extFile);
        extFile.queryInfoAsync = ExtFile.prototype.queryInfoAsync.bind(extFile);
        extFile.queryFilesystemInfoAsync = ExtFile.prototype.queryFilesystemInfoAsync.bind(extFile);
        
        return extFile;
    }

    /**
     * Creates a {@link ExtFile} with the given argument from the command line.
     * The value of `arg` can be either a URI, an absolute path or a
     * relative path resolved relative to the current working directory.
     * This operation never fails, but the returned object might not
     * support any I/O operation if `arg` points to a malformed path.
     * 
     * Note that on Windows, this function expects its argument to be in
     * UTF-8 -- not the system code page.  This means that you
     * should not use this function with string from argv as it is passed
     * to main().  g_win32_get_command_line() will return a UTF-8 version of
     * the commandline.  #GApplication also uses UTF-8 but
     * g_application_command_line_create_file_for_arg() may be more useful
     * for you there.  It is also always possible to use this function with
     * #GOptionContext arguments of type %G_OPTION_ARG_FILENAME.
     * @param arg a command line string
     */
    static newForCommandlineArg(arg: string): ExtFile {
        const file = super.new_for_commandline_arg(arg);
        return this.extend(file);
    }

    /**
     * Creates a {@link ExtFile} with the given argument from the command line.
     * 
     * This function is similar to g_file_new_for_commandline_arg() except
     * that it allows for passing the current working directory as an
     * argument instead of using the current working directory of the
     * process.
     * 
     * This is useful if the commandline argument was given in a context
     * other than the invocation of the current process.
     * 
     * See also g_application_command_line_create_file_for_arg().
     * @param arg a command line string
     * @param cwd the current working directory of the commandline
     */
    static newForCommandlineArgAndCwd(arg: string, cwd: string) {
        const file = super.new_for_commandline_arg_and_cwd(arg, cwd);
        return this.extend(file);
    }

    /**
     * Constructs a {@link ExtFile} for a given path. This operation never
     * fails, but the returned object might not support any I/O
     * operation if `path` is malformed.
     * @param path a string containing a relative or absolute path. The string must be encoded in the glib filename encoding.
     */
    static newForPath(path: string) {
        const file = super.new_for_path(path);
        return this.extend(file);
    }

    /**
     * Constructs a {@link ExtFile} for a given URI. This operation never
     * fails, but the returned object might not support any I/O
     * operation if `uri` is malformed or if the uri type is
     * not supported.
     * @param uri a UTF-8 string containing a URI
     */
    static newForUri(uri: string) {
        const file = super.new_for_uri(uri);
        return this.extend(file);
    }

    /**
     * Opens a file in the preferred directory for temporary files (as
     * returned by g_get_tmp_dir()) and returns a {@link ExtFile} and
     * ExtFileIOStream pointing to it.
     * 
     * `tmpl` should be a string in the GLib file name encoding
     * containing a sequence of six 'X' characters, and containing no
     * directory components. If it is %NULL, a default template is used.
     * 
     * Unlike the other ExtFile constructors, this will return %NULL if
     * a temporary file could not be created.
     * @param tmpl Template for the file   name, as in g_file_open_tmp(), or %NULL for a default template
     */
    static newTmp(tmpl: string | null) {
        const [ file, ioStream] = super.new_tmp(tmpl);
        const extFile = this.extend(file);
        return {
            file: extFile,
            ioStream,
        }
    }

    /**
     * Asynchronously opens a file in the preferred directory for temporary files
     *  (as returned by g_get_tmp_dir()) as g_file_new_tmp().
     * 
     * `tmpl` should be a string in the GLib file name encoding
     * containing a sequence of six 'X' characters, and containing no
     * directory components. If it is %NULL, a default template is used.
     * @param tmpl Template for the file   name, as in g_file_open_tmp(), or %NULL for a default template
     * @param ioPriority the [I/O priority][io-priority] of the request
     * @param cancellable optional #GCancellable object, %NULL to ignore
     * @param callback a #GAsyncReadyCallback to call when the request is done
     */
    static async newTmpAsync(tmpl: string | null, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null) {
        return new Promise<{file: ExtFile, ioStream: Gio.FileIOStream}>((resolve, reject) => {
            this.new_tmp_async(tmpl, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const [file, ioStream] = this.new_tmp_finish(asyncRes);
                    const extFile = this.extend(file);
                    return resolve({file: extFile, ioStream});
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Asynchronously creates a directory in the preferred directory for
     * temporary files (as returned by g_get_tmp_dir()) as g_dir_make_tmp().
     * 
     * `tmpl` should be a string in the GLib file name encoding
     * containing a sequence of six 'X' characters, and containing no
     * directory components. If it is %NULL, a default template is used.
     * @param tmpl Template for the file   name, as in g_dir_make_tmp(), or %NULL for a default template
     * @param ioPriority the [I/O priority][io-priority] of the request
     * @param cancellable optional #GCancellable object, %NULL to ignore
     */
    static async newTmpDirAsync(tmpl: string | null, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null) {
        return new Promise<ExtFile>((resolve, reject) => {
            this.new_tmp_dir_async(tmpl, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const file = this.new_tmp_dir_finish(asyncRes);
                    const extFile = this.extend(file);
                    return resolve(extFile);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Constructs a {@link ExtFile} with the given `parse_name` (i.e. something
     * given by g_file_get_parse_name()). This operation never fails,
     * but the returned object might not support any I/O operation if
     * the `parse_name` cannot be parsed.
     * @param parseName a file name or path to be parsed
     */
    static parseName(parseName: string) {
        const file = super.parse_name(parseName);
        return this.extend(file);
    }

    /**
     * Asynchronously creates a symbolic link named `file` which contains the
     * string `symlinkValue`.
     * @param symlinkValue a string with the path for the target   of the new symlink
     * @param ioPriority the [I/O priority][io-priority] of the request
     * @param cancellable optional #GCancellable object,   %NULL to ignore
     */
    async makeSymbolicLinkAsync(symlinkValue: string, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<boolean>((resolve, reject) => {
            this.make_symbolic_link_async(symlinkValue, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const newSymlinkCreated = this.make_symbolic_link_finish(asyncRes);
                    return resolve(newSymlinkCreated);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Asynchronously gets the requested information about specified `file`.
     * The result is a #GFileInfo object that contains key-value attributes
     * (such as type or size for the file).
     * 
     * For more details, see g_file_query_info() which is the synchronous
     * version of this call.
     * 
     * When the operation is finished, `callback` will be called. You can
     * then call g_file_query_info_finish() to get the result of the operation.
     * @param attributes an attribute query string
     * @param flags a set of #GFileQueryInfoFlags
     * @param ioPriority the [I/O priority][io-priority] of the request
     * @param cancellable optional #GCancellable object,   %NULL to ignore
     */
    async queryInfoAsync(attributes: string, flags: Gio.FileQueryInfoFlags, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<Gio.FileInfo>((resolve, reject) => {
            this.query_info_async(attributes, flags, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const fileInfo = this.query_info_finish(asyncRes);
                    return resolve(fileInfo);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Asynchronously gets the requested information about the filesystem
     * that the specified `file` is on. The result is a #GFileInfo object
     * that contains key-value attributes (such as type or size for the
     * file).
     * 
     * For more details, see g_file_query_filesystem_info() which is the
     * synchronous version of this call.
     * 
     * When the operation is finished, `callback` will be called. You can
     * then call g_file_query_info_finish() to get the result of the
     * operation.
     * @param attributes an attribute query string
     * @param ioPriority the [I/O priority][io-priority] of the request
     * @param cancellable optional #GCancellable object,   %NULL to ignore
     */
    async queryFilesystemInfoAsync(attributes: string, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<Gio.FileInfo>((resolve, reject) => {
            this.query_filesystem_info_async(attributes, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const fileInfo = this.query_filesystem_info_finish(asyncRes);
                    return resolve(fileInfo);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
}