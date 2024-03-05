import { basename } from "https://deno.land/std/path/mod.ts";

import { OpMethod, OpSource } from "../types.ts";

export async function boilerplateGenerator(
  source: OpSource,
  method: OpMethod,
): Promise<string> {
  console.log(
    `\nGenerate boilerplate for function ${method.functionName} in file ${
      basename(source.path)
    }...`,
  );

  return `// deno-lint-ignore no-explicit-any
export function ${method.functionName}(...args: any[]) {
  console.warn("Method '${method.functionName}' needs to be implemented. Args: ", args);
}`;
}
