import { basename } from "https://deno.land/std/path/mod.ts";

import { BaseGenerator } from "./base.generator.ts";
import { OpMethod, OpSource } from "../types.ts";

export class BoilerplateGenerator extends BaseGenerator {
  public async generate(
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
}
