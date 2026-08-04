// @gjsify/devtools — in-app DBus devtools control plane (GTK/GJS).
// Pure named exports; opt-in via installDevtools() (no global side effects).

export { chooseDevtoolsTransport, installDevtools, uninstallDevtools } from './install.js';
export type { DevtoolsTransportChoice } from './install.js';
export { DevtoolsService } from './devtools-service.js';
export type { DevtoolsExtension, InstallDevtoolsOptions } from './extension.js';
export { removeDevtoolsAddressFile, startDevtoolsPeerServer, writeDevtoolsAddressFile } from './peer-transport.js';
export type { DevtoolsPeerServer } from './peer-transport.js';
export { captureWidgetPng } from './screenshot.js';
export { buildVariant, variantKindFor } from './gvariant.js';
export type { VariantKind } from './gvariant.js';
export { activateAction, changeActionState, describeActions } from './actions.js';
export { buildDevtoolsIfaceXml } from './devtools-iface.js';
export {
    buildWidgetPath,
    dumpTree,
    getWidgetProperty,
    listToplevels,
    parseWidgetPath,
    pathOfWidget,
    resolveWidgetPath,
    widgetType,
} from './widget-tree.js';
export { dumpCss, removeCss, swapCss } from './css.js';
export { dumpGSettings } from './gsettings.js';

// Re-export the transport-agnostic contract so a consumer needs one import.
export * from '@gjsify/devtools-protocol';
