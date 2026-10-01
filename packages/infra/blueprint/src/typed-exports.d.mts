// Declarations for `typed-exports.mjs` — ADR 0087's third exit.
//
// Hand-written beside the implementation, for the reason `ast.d.mts` § WHY A DECLARATION FILE
// AND NOT A `.ts` gives: this package has no build step, because the gate that runs it installs
// the workspace and does not build it.

import type { BlueprintFile } from './ast.mjs';

/**
 * One id a `.blp` declares, with both spellings of its name and the type it is.
 *
 * Two spellings and not one, because the two exits need different ones: `build()` keys its
 * result by the id AS WRITTEN (`builder.get_object` takes exactly that string), and a template's
 * internal child is reached through the `_`-prefixed member GJS installs for it.
 */
export interface BlueprintIdentifier {
    /** The id as the source wrote it: `Gtk.MenuButton menuButton { }` is `menuButton`. */
    readonly id: string;
    /** The GJS internal-child member: `_` + the id with dashes as underscores. MEASURED, see the impl. */
    readonly member: string;
    /** The TypeScript type expression, e.g. `Adw.ButtonContent`. Namespace-qualified, always. */
    readonly type: string;
    /** The `gi://` namespace {@link BlueprintIdentifier.type} needs imported. */
    readonly namespace: string;
    /** 1-based line the id was declared on, as every AST node's is. */
    readonly line: number;
}

/** The `template $Name: Parent { }` half — absent where the file declares no such class. */
export interface BlueprintTemplateExports {
    /** The class the template DEFINES, without the `$`. What `registerClass` is given. */
    readonly GTypeName: string;
    /** Every id inside the template body, in source order. */
    readonly children: readonly BlueprintIdentifier[];
    readonly line: number;
}

/** What one `.blp` exports, as facts. The two emitters below are the only readers. */
export interface BlueprintExports {
    /** The `using` lines, namespace → version. What a `gi://` specifier is built from. */
    readonly namespaces: Readonly<Record<string, string>>;
    /**
     * Present only for the `$Name` sigil form. `template ListItem { }` names an EXISTING type,
     * so there is no class to register and nothing to export — see the implementation.
     */
    readonly template?: BlueprintTemplateExports;
    /** Every id reachable through `builder.get_object`, in source order. */
    readonly objects: readonly BlueprintIdentifier[];
}

/**
 * The ids, types and template a `.blp` declares — ADR 0087 § 2 and § 3.
 *
 * Throws a `BlueprintEmitError` where an id would collide with the `builder` key `build()`
 * returns beside them.
 */
export declare function deriveExports(file: BlueprintFile): BlueprintExports;

/** The `x.d.blp.ts` text — what `allowArbitraryExtensions` reads (ADR 0087 § 4). */
export declare function emitTypedSidecar(file: BlueprintFile): string;

/** The module a bundler gets: the XML `default`, plus the named exports the sidecar declares. */
export declare function emitTypedModule(file: BlueprintFile, xml: string): string;

/** `header-bar.blp` → `header-bar.d.blp.ts`. */
export declare function sidecarPathFor(blueprintPath: string): string;
