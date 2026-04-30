// Phase 4b GJS bundle stub for `@ts-for-gir/generator-json`. The upstream
// package's `typedoc-pipeline.ts` imports a wide slice of `typedoc`. Cutting
// the tree here keeps the GJS bundle small. The CLI imports only
// `JsonDefinitionGenerator` from this package (in `generation-handler.ts`);
// commands that DON'T construct it work unchanged. `ts-for-gir json` throws
// on first use with a clear message.

const stubError = () =>
  new Error(
    `[gjsify-cli-gjs-stub] JsonDefinitionGenerator is not available in the GJS CLI bundle ` +
    `(typedoc cannot currently be bundled for SpiderMonkey 128). Use the Node bundle ` +
    `or generate JSON from a separate Node-only invocation.`,
  );

export class JsonDefinitionGenerator {
  constructor() {
    throw stubError();
  }
}
