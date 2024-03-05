import { OpMethod, OpSource } from "../types.ts";

export abstract class BaseGenerator {
  abstract generate(
    source: OpSource,
    method: OpMethod,
  ): Promise<string>;
}
