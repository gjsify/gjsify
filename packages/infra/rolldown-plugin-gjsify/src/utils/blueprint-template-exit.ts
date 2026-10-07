/**
 * What `./x.blp?template` means on a target with no GtkBuilder (ADR 0096 § 4): the projected
 * tree, checked against the renderer the target's `--gi-renderer` arm names, so the import site
 * writes no `for=`. Without the arm there is no renderer to check against and no reader for the
 * XML string, so the import is refused at build time, naming the flag.
 */
export function blueprintTemplateExit(
    app: string,
    giRenderer: { renderer: string } | undefined,
): { renderer: string } | { refusal: string } {
    if (giRenderer === undefined) {
        return {
            refusal:
                `On --app ${app} it is the projected tree of the renderer --gi-renderer composes, and ` +
                'that flag is off. Pass --gi-renderer, or import the file without `?template`.',
        };
    }
    // `for=` names the package without its scope.
    return { renderer: giRenderer.renderer.replace(/^@gjsify\//, '') };
}
