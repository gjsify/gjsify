// deno run --allow-read --allow-net tools/generate_op_methods/mod.ts

import { askOpenAIAboutFunction } from './openai.ts';
import type { OpMethod, OpSource } from './types.ts';

async function findRustFunctions(dir: string): Promise<OpSource[]> {
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

function extractMethods(fileContent: string): OpMethod[] {
    const methodRegex = /(#\[(op|op2)\(?.*?\)\]|\[#(op|op2)\])\s*(pub\s+(async\s+)?fn\s+op_[a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(->\s*[^{]+)?\s*{([^]*?)}\s*?(?=#\[|pub|$)/gs;
    const methods: OpMethod[] = [];

    let match;
    while ((match = methodRegex.exec(fileContent)) !== null) {
        const macro = match[1];
        const definition = match[4];
        const completeFunction = match[0]; // The entire matched string is the complete function
        const functionName = match[4].split(' ')[3]; // Extracting the function name

        methods.push({
            functionName,
            definition,
            macro,
            completeFunction: completeFunction.trim(),
        });
    }

    return methods;
}

const startDir = '.'; // Replace with your start directory
const results = await findRustFunctions(startDir);
console.log(JSON.stringify(results[0], null, 2));

const answers = await askOpenAIAboutFunction(results[0], results[0].methods[0])
console.log(answers.answers[0]);