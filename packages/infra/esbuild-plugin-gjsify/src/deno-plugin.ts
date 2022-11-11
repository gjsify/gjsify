// Based on https://github.com/jed/esbuild-plugin-deno
// TODO fork https://github.com/lucacasonato/esbuild_deno_loader instead?

import type {
    Plugin,
    Loader,
    OnLoadArgs,
    OnResolveArgs,
    PluginBuild,
} from "esbuild";

const NAME = "deno";
const NAMESPACE = NAME;

const resolveFile = ({ path }: OnResolveArgs) => ({
    path: path,
    namespace: NAMESPACE,
});

const resolveUrl = ({ path, importer }: OnResolveArgs) => ({
    path: new URL(path, importer).href,
    namespace: NAMESPACE,
});

const loadSource = async ({ path }: OnLoadArgs) => {
    const source = await fetch(path);

    if (!source.ok) {
        const message = `GET ${path} failed: status ${source.status}`;
        throw new Error(message);
    }

    let contents = await source.text();
    const pattern = /\/\/# sourceMappingURL=(\S+)/;
    const match = contents.match(pattern);
    if (match) {
        const url = new URL(match[1], source.url);
        const dataurl = await loadMap(url);
        const comment = `//# sourceMappingURL=${dataurl}`;
        contents = contents.replace(pattern, comment);
    }

    const { pathname } = new URL(source.url);
    const loader = (pathname.match(/[^.]+$/)?.[0]) as (Loader | undefined);

    return { contents, loader };
};

const loadMap = async (url: URL) => {
    const map = await fetch(url);
    const type = map.headers.get("content-type")?.replace(/\s/g, "");
    const buffer = await map.arrayBuffer();
    const blob = new Blob([buffer], { type });
    const reader = new FileReader();
    return new Promise((cb) => {
        reader.onload = (e) => cb(e.target?.result);
        reader.readAsDataURL(blob);
    });
};

export const denoPlugin = (options: undefined = undefined) => {
    const plugin: Plugin = {
        name: NAME,
        setup: ({ onResolve, onLoad }: PluginBuild) => {
            onResolve({ filter: /^https?:\/\// }, resolveFile);
            onResolve({ filter: /.*/, namespace: NAMESPACE }, resolveUrl);
            onLoad({ filter: /.*/, namespace: NAMESPACE }, loadSource);
        },
    }
    return plugin;
}

export default denoPlugin;