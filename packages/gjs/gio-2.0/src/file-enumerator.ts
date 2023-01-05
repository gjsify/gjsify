import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

export class ExtFileEnumerator extends Gio.FileEnumerator /* TODO implements Iterable<Gio.FileInfo>, AsyncIterable<Gio.FileInfo> */{

    /**
     * Creates a new instance of `ExtFileEnumerator` extended on a existing `Gio.FileEnumerator` instance.
     * @param file The original unextended `ExtFileEnumerator`
     * @returns The `Gio.FileEnumerator` extended to `ExtFileEnumerator`
     */
    static extend(enumerator: Gio.FileEnumerator) {
        const extEnumerator = enumerator as Gio.FileEnumerator & ExtFileEnumerator;
        extEnumerator.nextFilesAsync = ExtFileEnumerator.prototype.nextFilesAsync.bind(extEnumerator);
        extEnumerator.nextFileAsync = ExtFileEnumerator.prototype.nextFileAsync.bind(extEnumerator);        
        return extEnumerator;
    }

    nextFilesAsync(numFiles: number, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<Gio.FileInfo[]>((resolve, reject) => {
            this.next_files_async(numFiles, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const fileInfos = this.next_files_finish(asyncRes);
                    resolve(fileInfos);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // TODO implement AsyncIterable<Gio.FileInfo>
    async nextFileAsync(ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        const fileInfos = await this.nextFilesAsync(1, ioPriority, cancellable);
        return fileInfos[0];
    }
}