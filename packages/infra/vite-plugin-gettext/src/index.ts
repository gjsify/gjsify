// Skeleton — implementation lands in commit 2 (port from external gjsify/vite repo).

export interface GettextPluginOptions {
    poDirectory?: string;
    outputDirectory?: string;
    domain?: string;
    format?: 'mo' | 'json' | 'xml';
    templateFile?: string;
    filename?: string;
}

export function xgettextPlugin(_options: GettextPluginOptions = {}): unknown {
    throw new Error('@gjsify/vite-plugin-gettext: xgettextPlugin not implemented yet');
}

export function msgfmtPlugin(_options: GettextPluginOptions = {}): unknown {
    throw new Error('@gjsify/vite-plugin-gettext: msgfmtPlugin not implemented yet');
}

export function po2jsonPlugin(_options: GettextPluginOptions = {}): unknown {
    throw new Error('@gjsify/vite-plugin-gettext: po2jsonPlugin not implemented yet');
}
