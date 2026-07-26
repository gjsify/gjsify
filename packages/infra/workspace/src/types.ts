// Shared workspace shapes. Type-only module — no runtime code, so discovery,
// the dependency graph and the changed-files matcher can all depend on it
// without importing each other just for a shape.

export interface WorkspaceManifest {
    name?: string;
    version?: string;
    private?: boolean;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    workspaces?: string[] | { packages?: string[]; nohoist?: string[] };
    [key: string]: unknown;
}

export interface Workspace {
    /** Absolute path of the workspace directory. */
    location: string;
    /** Workspace-relative location (e.g. `packages/infra/cli`). */
    relativeLocation: string;
    /** `<name>` from package.json — required for resolving `workspace:^`. */
    name: string;
    /** `<version>` from package.json — used to substitute `workspace:^`. */
    version: string;
    /** Loaded package.json contents (manifest). */
    manifest: WorkspaceManifest;
    /** `private: true` packages are excluded by `--no-private`. */
    private: boolean;
}
