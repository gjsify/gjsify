// Phase 4b GJS bundle stub for `@ts-for-gir/generator-html-doc`. The upstream
// package pulls in `typedoc` and `@ts-for-gir/typedoc-theme`, which together
// account for ~hundreds of value imports. Cutting the tree here keeps the
// bundle small. The CLI imports only `HtmlDocGenerator` from this package
// (in `generation-handler.ts`); commands that DON'T construct it
// (`--version`, `--help`, `list`, `copy`, `analyze`) work unchanged. The
// `doc` command throws on first use with a clear message.

const stubError = () =>
  new Error(
    `[gjsify-cli-gjs-stub] HtmlDocGenerator is not available in the GJS CLI bundle ` +
    `(typedoc cannot currently be bundled for SpiderMonkey 128). Use the Node bundle ` +
    `or generate docs from a separate Node-only invocation.`,
  );

export class HtmlDocGenerator {
  constructor() {
    throw stubError();
  }
}
