import Gio from '@gjsify/types/Gio-2.0';

const byteArray = imports.byteArray;

import { getEncodingFromOptions } from './encoding.js';

async function readFile(path: string, options = { encoding: null, flag: 'r' }) {
  const file = Gio.File.new_for_path(path);

  const [ok, data] = await new Promise<[boolean, Uint8Array, string]>((resolve, reject) => {
    file.load_contents_async(null, (self, res) => {
      resolve(file.load_contents_finish(res));
    });
  });

  if (!ok) {
    // TODO: throw a better error
    throw new Error('failed to read file');
  }

  const encoding = getEncodingFromOptions(options, 'buffer');
  if (encoding === 'buffer') {
    return Buffer.from(data);
  }

  // TODO more encodings
  return byteArray.toString(data);
}

export {
  readFile,
};

export default {
  readFile,
};