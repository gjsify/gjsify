// Phase 4b GJS bundle stub for `prettier`. See README.md in this directory.
// `@ts-for-gir/cli`'s TypeScriptFormatter calls `prettier.format(text, opts)`
// to pretty-print the generated `.d.ts` output. We pass through unmodified —
// the generated TypeScript is still syntactically valid, just not formatted.
// `prettier.resolveConfig` returns `null` (the formatter treats this as
// "no project config", which is the same path Node takes when no
// `.prettierrc` exists).

const passThrough = async (source: string, _options?: unknown): Promise<string> => source;
const noConfig = async (_filePath: string): Promise<null> => null;

const stub = {
  format: passThrough,
  formatWithCursor: async (source: string, _options?: unknown) => ({ formatted: source, cursorOffset: 0 }),
  resolveConfig: noConfig,
  resolveConfigFile: noConfig,
  clearConfigCache: () => {},
  getFileInfo: async (_filePath: string) => ({ ignored: false, inferredParser: null }),
  version: '3.8.3-gjsify-stub',
};

export default stub;
export const format = stub.format;
export const formatWithCursor = stub.formatWithCursor;
export const resolveConfig = stub.resolveConfig;
export const resolveConfigFile = stub.resolveConfigFile;
export const clearConfigCache = stub.clearConfigCache;
export const getFileInfo = stub.getFileInfo;
export const version = stub.version;
