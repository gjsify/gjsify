export {
    BLOCK_SIZE,
    parseTar,
    TarParseError,
    type TarEntry,
    type TarEntryType,
} from "./parser.ts";
export { extractTarball, gunzip, type ExtractOptions, type ExtractResult } from "./extract.ts";
