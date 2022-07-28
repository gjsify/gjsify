import { sys, findConfigFile, parseConfigFileTextToJson, parseJsonConfigFileContent } from 'typescript';
import { dirname } from 'path';
import { cwd as Cwd } from 'process';
import { printDiagnostics } from './log.js';

// See https://github.com/thomaschaaf/esbuild-plugin-tsc/blob/62dd7d1a3db45ddd8bda7257271ea102a37581e4/src/index.js#L60
export const parseTsConfig = (tsconfigName?: string, cwd = Cwd()) => {
    const fileName = findConfigFile(
      cwd,
      sys.fileExists,
      tsconfigName
    );
  
    // if the value was provided, but no file, fail hard
    if (tsconfigName !== undefined && !fileName)
      throw new Error(`failed to open '${fileName}'`);
  
    let loadedConfig = {};
    let baseDir = cwd;
    if (fileName) {
      const text = sys.readFile(fileName);
      if (text === undefined) throw new Error(`failed to read '${fileName}'`);
  
      const result = parseConfigFileTextToJson(fileName, text);
  
      if (result.error !== undefined) {
        printDiagnostics(result.error);
        throw new Error(`failed to parse '${fileName}'`);
      }
  
      loadedConfig = result.config;
      baseDir = dirname(fileName);
    }
  
    const parsedTsConfig = parseJsonConfigFileContent(
      loadedConfig,
      sys,
      baseDir
    );
  
    if (parsedTsConfig.errors[0]) printDiagnostics(parsedTsConfig.errors);
  
    return parsedTsConfig;
}