// @gjsify/devtools — in-app DBus devtools control plane (GTK/GJS).
// Pure named exports; opt-in via installDevtools() (no global side effects).

export { installDevtools, uninstallDevtools } from './install.js';
export { DevtoolsService } from './devtools-service.js';
export type { DevtoolsExtension, InstallDevtoolsOptions } from './extension.js';
export { captureWidgetPng } from './screenshot.js';
export { buildVariant, variantKindFor } from './gvariant.js';
export type { VariantKind } from './gvariant.js';
export { activateAction, changeActionState, describeActions } from './actions.js';
export { buildDevtoolsIfaceXml } from './devtools-iface.js';

// Re-export the transport-agnostic contract so a consumer needs one import.
export * from '@gjsify/devtools-protocol';
