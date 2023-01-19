import type { BuildOptions } from "esbuild";
import fastGlob from 'fast-glob';

export const globToEntryPoints = async (_entryPoints: BuildOptions['entryPoints'], ignore: string[] = []) => {

    if(Array.isArray(_entryPoints) && typeof _entryPoints[0] === 'string') {
        return await fastGlob(_entryPoints as string[], {ignore})
    } else if(Array.isArray(_entryPoints) && typeof _entryPoints[0] === 'object') {
        const entryPoints: { in: string, out: string }[] = [];

        for(const entryPoint of _entryPoints as { in: string, out: string }[]) {
            const inputs = await fastGlob(entryPoint.in, {ignore})

            for (let i = 0; i < inputs.length; i++) {
                entryPoints.push({
                    in: inputs[i],
                    out: entryPoint.out
                })
            }
        }

        return entryPoints;
    }
    const entryPoints: Record<string, string> = {};
    for (const input in _entryPoints as Record<string, string>) {
        const output = entryPoints[input];
        const inputs = await fastGlob(input, {ignore});
        for (const input of inputs) {
            entryPoints[input] = output;
        }
    }
    return entryPoints;
}