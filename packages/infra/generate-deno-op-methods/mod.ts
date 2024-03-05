// deno run --allow-read --allow-net tools/generate_op_methods/mod.ts

import { BoilerplateGenerator, llmGenerator } from "./generators/index.ts";
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
      tsContent = await llmGenerator.generate(data, method);
    } else {
      tsContent = await new BoilerplateGenerator().generate(data, method);
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
