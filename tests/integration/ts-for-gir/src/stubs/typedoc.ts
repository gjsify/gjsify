// Phase 4b GJS bundle stub for `typedoc`. See README.md in this directory.
// Only the symbols that ts-for-gir's `generator-html-doc` and `generator-json`
// import at top level need to exist as real values — the rest can be omitted.

const stubError = (caller: string) =>
  new Error(
    `[gjsify-cli-gjs-stub] typedoc.${caller}() is not available in the GJS CLI bundle. ` +
    `Run on Node, or wait for Phase 5 (typedoc on GJS).`,
  );

export class DeclarationReflection {
  constructor() {
    throw stubError('DeclarationReflection');
  }
}

export class DeserializerComponent {
  constructor() {
    throw stubError('DeserializerComponent');
  }
}

export class SerializerComponent {
  constructor() {
    throw stubError('SerializerComponent');
  }
}

// `Application` is imported as `import type` only from generator-html-doc, so
// it is erased at bundle time. We still export a dummy class so esbuild does
// not warn if the import becomes a value import in a future upstream change.
export class Application {
  constructor() {
    throw stubError('Application');
  }
}
