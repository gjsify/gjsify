export const getJsExtensions = (allowExt?: string) => {
    const extensions: Record<string, string> = {'.js': '.js', '.ts': '.js', '.mts': '.js', '.cts': '.js', '.cjs': '.js', '.mjs': '.js'};
    if(allowExt && extensions[allowExt]) {
        delete extensions[allowExt]
    }
    return extensions;
}