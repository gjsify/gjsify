// deno run --allow-read --allow-net tools/generate_op_methods/mod.ts

import { askLLMAboutFunction } from "./openai.ts";
import { findRustFunctions } from "./rust.ts";
import { writeToFile } from "./file.ts";
import { exists } from "https://deno.land/std@0.211.0/fs/mod.ts";

import type { OpSource } from "./types.ts";

const getOpTsFilePath = (path: string, methodName: string) => {
  const filename = path.split("/").pop()!;
  const parentDir = path.replace(filename, "");
  const dir = parentDir + "gjsify_" + filename.replace(/\.rs$/, "");
  return dir + "/" + methodName + ".ts";
};

async function processFile(data: OpSource) {
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

    const answers = await askLLMAboutFunction(data, method);
    console.debug("question: ", answers.question);
    console.debug("answer: ", answers.answers[0]);
    console.debug("code:", answers.codeBlocks[0]);

    const tsContent = answers.codeBlocks.join("\n\n");

    await writeToFile(tsMethodPath, tsContent);

    methodIndex++;
  }
}

async function start(rootDir = ".") {
  const results = await findRustFunctions(rootDir);

  // console.debug(JSON.stringify(results[0], null, 2));

  let fileIndex = 0;
  for (const result of results) {
    const res = await processFile(result);

    if (!res) continue;

    // Break after first file iteration for testing
    if (fileIndex === 0) break;

    fileIndex++;
  }
}

await start("../../deno/runtime-2/src");
