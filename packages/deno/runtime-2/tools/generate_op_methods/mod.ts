// deno run --allow-read --allow-net tools/generate_op_methods/mod.ts

import { askOpenAIAboutFunction } from './openai.ts';
import { findRustFunctions } from './rust.ts';
import { exists } from 'https://deno.land/std/fs/mod.ts';
import type { OpMethod, OpSource } from './types.ts';


const startDir = '.'; // Replace with your start directory
const results = await findRustFunctions(startDir);
// console.debug(JSON.stringify(results[0], null, 2));

let fileIndex = 0;
for (const result of results) {
    const tsPath = result.path.replace('.rs', '.ts');

    // TODO: Check if all op methods are already added to the ts file
    if(await exists(tsPath)) {
        console.warn(`File ${tsPath} already exists, skipping...`);
        continue;
    }

    let tsContent = '';
    let methodIndex = 0;
    for (const method of result.methods) {
        const answers = await askOpenAIAboutFunction(result, method)
        console.debug("answer: ", answers.answers[0]);
        console.debug("code:", answers.codeBlocks[0]);

        tsContent += answers.codeBlocks[0];
        tsContent += '\n\n';

        // Break after first method iteration for testing
        // if(methodIndex === 0) break;

        methodIndex++;
    }

    // Write to file
    const encoder = new TextEncoder();
    const data = encoder.encode(tsContent);
    await Deno.writeFile(tsPath, data);
    console.log(`Wrote ${tsPath}`);

    // Break after first file iteration for testing
    if(fileIndex === 0) break;

    fileIndex++;
}

