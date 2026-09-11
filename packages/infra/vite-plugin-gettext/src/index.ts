export { CatalogShrinkError, EmptySourcePatternError, GettextGuardError, InvalidEntryLossError } from './guards.js';
export {
    catalogNames,
    CollidingCatalogNameError,
    planCatalogNames,
    posixLocaleDirectories,
    UnmappableCatalogNameError,
} from './catalog-names.js';
export type { CatalogNames, CatalogNamespace } from './catalog-names.js';
export { gettextPlugin } from './gettext.js';
export { msgfmtPlugin } from './msgfmt.js';
export { xgettextPlugin } from './xgettext.js';
export { po2jsonPlugin } from './po2json.js';
export type {
    GettextPluginOptions,
    GettextPo2JsonPluginOptions,
    MsgfmtPluginOptions,
    MsgfmtFormat,
    XGettextPluginOptions,
} from './types.js';
export * from './utils.js';
