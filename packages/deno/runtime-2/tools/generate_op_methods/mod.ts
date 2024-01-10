// deno run --allow-read --allow-net tools/generate_op_methods/mod.ts

import { askOpenAIAboutFunction } from './openai.ts';
import { findRustFunctions } from './rust.ts';
import { exists } from 'https://deno.land/std/fs/mod.ts';

import type { OpSource } from './types.ts';

async function processFile(data: OpSource) {
    const tsPath = data.path.replace('.rs', '.ts');

    // TODO: Check if all op methods are already added to the ts file
    if(await exists(tsPath)) {
        console.warn(`File ${tsPath} already exists, skipping...`);
        return null;
    }

    console.log(`\n\nProcessing file ${data.path} (${data.methods.length} methods)...`);

    let tsContent = '';
    let methodIndex = 0;
    for (const method of data.methods) {
        const answers = await askOpenAIAboutFunction(data, method)
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
    await Deno.writeFile(tsPath, encoder.encode(tsContent));
    console.log(`Wrote ${tsPath}`);
    return tsContent;
}

async function start() {
    const startDir = '.'; // Replace with your start directory
    const results = await findRustFunctions(startDir);

    // console.debug(JSON.stringify(results[0], null, 2));

    let fileIndex = 0;
    for (const result of results) {
        const res = await processFile(result);

        if(!res) continue;

        // Break after first file iteration for testing
        if(fileIndex === 0) break;

        fileIndex++;
    }
}

await start();