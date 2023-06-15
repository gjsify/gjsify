import '@girs/gjs';
import Gio from '@girs/gio-2.0';

const ByteArray = imports.byteArray;

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

async function cat(filename: string) {
    const file = Gio.file_new_for_path(filename);

    const [contents] = await file.load_contents_async(null);
    print(ByteArray.toString(contents));
}


if (ARGV.length !== 1)
    printerr('Usage: gio-cat.js filename');
else {
    await cat(ARGV[0]);
}
