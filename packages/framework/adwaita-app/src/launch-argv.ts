// The argv a GApplication is launched with — pure, so Node can spec it.

/**
 * `options.argv` verbatim when given, else the program name followed by the process's own
 * arguments.
 *
 * The default is right for an app that IS the process. An app started from a subcommand
 * (`tool gui`) must pass its own `argv`: GApplication reads every non-option argument as a
 * file to open, so the forwarded `gui` is refused with "This application can not open files"
 * unless the app declares `HANDLES_OPEN`.
 */
export function launchArgv(argv: string[] | undefined, programName: string, programArgs: string[]): string[] {
    return argv ?? [programName, ...programArgs];
}
