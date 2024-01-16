import type { OpMethod, OpSource } from './types.ts';

export async function findRustFunctions(dir: string): Promise<OpSource[]> {
    const results: OpSource[] = [];

    for await (const entry of Deno.readDir(dir)) {
        const fullPath = `${dir}/${entry.name}`;

        if (entry.isDirectory) {
            results.push(...await findRustFunctions(fullPath));
        } else if (entry.isFile && fullPath.endsWith('.rs')) {
            const fileContent = await Deno.readTextFile(fullPath);
            const methods = extractMethods(fileContent);
            if (!methods.length) {
                continue;
            }
            results.push({
                path: fullPath,
                methods,
                content: fileContent.trim(),
            });
        }
    }

    return results;
}

function extractMethodName(rustCode: string): string | null {
    const methodRegex = /fn\s+(op_[^\s\(]+)/;
    const match = rustCode.match(methodRegex);
    return match ? match[1] : null;
}

function extractMethods(fileContent: string): OpMethod[] {
    const methodRegex = /(#\[(op|op2)\(?.*?\)\]|\[#(op|op2)\])\s*(pub\s+(async\s+)?fn\s+op_[a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(->\s*[^{]+)?\s*{([^]*?)}\s*?(?=#\[|pub|$)/gs;
    const methods: OpMethod[] = [];

    let match;
    while ((match = methodRegex.exec(fileContent)) !== null) {
        const macro = match[1];
        const definition = match[4];
        const completeFunction = match[0]; // The entire matched string is the complete function
        const functionName = extractMethodName(definition)

        if(!functionName) {
            console.warn('Could not extract function name from definition: ', match);
            continue;
        } else {
            // console.debug('Extracted function name: ', functionName);
        }

        methods.push({
            functionName,
            definition,
            macro,
            completeFunction: completeFunction.trim(),
            isAsync: functionName.includes('async') || macro.includes('async') || false,
        });
    }

    return methods;
}
