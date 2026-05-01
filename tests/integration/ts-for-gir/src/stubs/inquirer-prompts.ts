// Phase 4b GJS bundle stub for `@inquirer/prompts`. See README.md in this
// directory. The CLI uses `input` for the `create` command and `select` for
// version-conflict resolution inside `module-loader/prompt-handler.ts`.
// Both reject on call so non-interactive flag-driven flows surface a clear
// error instead of silently hanging.

const stubError = (kind: string) =>
  new Error(
    `[gjsify-cli-gjs-stub] @inquirer/prompts.${kind}() is not available in the GJS CLI bundle. ` +
    `Use the corresponding non-interactive CLI flag (e.g. --ignoreVersionConflicts).`,
  );

export const input = async (..._args: unknown[]): Promise<string> => {
  throw stubError('input');
};

export const select = async (..._args: unknown[]): Promise<string> => {
  throw stubError('select');
};
