// deno run --allow-read --allow-net tools/generate_op_methods/mod.ts

import { llmGenerator } from "./utils/llm.generator.ts";
import { boilerplateGenerator } from "./utils/boilerplate.generator.ts";
import {
  findRustFunctions,
  getOptions,
  getOpTsFilePath,
  printHelp,
  writeToFile,
} from "./utils/index.ts";
import { exists } from "https://deno.land/std@0.211.0/fs/mod.ts";

import type { OpSource, Options } from "./types.ts";

async function processFile(data: OpSource, options: Options) {
  console.log(
    `\n\nProcessing file ${data.path} (${data.methods.length} methods)...`,
  );

  let methodIndex = 0;
  for (const method of data.methods) {
    console.debug(`\n\nProcessing method ${method.functionName}...`);

    const tsMethodPath = getOpTsFilePath(
      data.path,
      method.functionName,
    );

    // TODO: Check if all op methods are already added to the ts file
    if (await exists(tsMethodPath)) {
      console.warn(`File ${tsMethodPath} already exists, skipping...`);
      return null;
    }

    let tsContent = "";
    if (options.ai) {
      const answers = await llmGenerator(data, method);
      if (!answers) continue;
      console.debug("question: ", answers.question);
      console.debug("answer: ", answers.answers[0]);
      console.debug("code:", answers.codeBlocks[0]);

      tsContent = answers.codeBlocks.join("\n\n");
    } else {
      tsContent = await boilerplateGenerator(data, method);
    }

    await writeToFile(tsMethodPath, tsContent, options);

    methodIndex++;
  }
}

async function start() {
  const options = getOptions();

  if (options.help) {
    printHelp(options);
    return;
  }

  console.debug("options: ", JSON.stringify(options, null, 2));

  const results = await findRustFunctions(options);

  // console.debug(JSON.stringify(results[0], null, 2));

  let fileIndex = 0;
  for (const result of results) {
    const res = await processFile(result, options);

    if (!res) continue;

    // Break after first file iteration for testing
    if (fileIndex === 0) break;

    fileIndex++;
  }
}

await start();
