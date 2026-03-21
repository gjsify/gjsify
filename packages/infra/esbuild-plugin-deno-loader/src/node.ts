
export const getNodeModulesPath = async (moduleName: string) => {

    if(!globalThis.require && import.meta.url) {
        const module = await import('module');
        const { createRequire } = module.default;
        globalThis.require = createRequire(import.meta.url);
    }   

    try {
        const mod = require.resolve(moduleName);
        return mod;
    } catch (error) {
        return null;
    }
}