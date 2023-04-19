import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import { existsSync } from './fs.js';

const File = Gio.File;

/** Cache the getArgs result */
const args: string[] = [];

export const getArgv = () => {

  if(args.length) {
    return args;
  }

  const [__filename] = GLib.filename_from_uri(import.meta.url);
  args.push(__filename);
  ARGV.forEach(arg => {
      if (arg[0] !== '-') {
        args.push(
              existsSync(arg) ?
                  File.new_for_path(arg).get_path() :
                  arg
          );
      } else {
        args.push(arg);
      }
  });

  return args;
}

export const getArgs = () => {
  return getArgv().slice(2);
}

export const parseArgv = (argv: string[]): { [key: string]: string | boolean } => {
  let result: { [key: string]: string | boolean } = {};
  let currentKey: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];

    if (arg.startsWith("--")) {
      currentKey = arg.substring(2);
      result[currentKey] = true;
    } else if (currentKey !== null) {
      result[currentKey] = arg;
      currentKey = null;
    } else {
      result[arg] = true;
    }
  }

  return result;
}
