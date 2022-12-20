import GLib from '@gjsify/types/GLib-2.0';
import Gio from '@gjsify/types/Gio-2.0';
import { existsSync } from './fs.js';

const File = Gio.File;

export const getArgs = () => {
    const [__filename] = GLib.filename_from_uri(import.meta.url);
    const arr: string[] = [__filename];
    ARGV.forEach(arg => {
        if (arg[0] !== '-') {
            arr.push(
                existsSync(arg) ?
                    File.new_for_path(arg).get_path() :
                    arg
            );
        } else {
            arr.push(arg);
        }
    });
    return arr;
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
  
  