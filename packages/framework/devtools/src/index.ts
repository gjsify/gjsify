// @gjsify/devtools — in-app DBus devtools control plane (GTK/GJS).
// Pure named exports; opt-in via installDevtools() (no global side effects).

export { chooseDevtoolsTransport, installDevtools, uninstallDevtools } from './install.js';
export type { DevtoolsTransportChoice } from './install.js';
export { DevtoolsService } from './devtools-service.js';
export type { DevtoolsExtension, InstallDevtoolsOptions } from './extension.js';
export {
    DevtoolsPeerServerError,
    removeDevtoolsAddressFile,
    startDevtoolsPeerServer,
    writeDevtoolsAddressFile,
} from './peer-transport.js';
export type { DevtoolsPeerServer } from './peer-transport.js';
export { captureWidget, captureWidgetPng, type CaptureBlocker, type CaptureResult } from './screenshot.js';
export { CaptureShotError, captureShot, pngSize } from './shot.js';
export type { CaptureShotOptions, PngSize, PngSource, ShotFailure, ShotResult } from './shot.js';
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
    widgetIsA,
    widgetType,
} from './widget-tree.js';
export { dumpCss, removeCss, swapCss } from './css.js';
export { hasRawPangoMarkup, isPangoMarkupSink, PANGO_MARKUP_SINKS, rawPangoMarkupIn } from './pango.js';
export { dumpGSettings } from './gsettings.js';

// Re-export the transport-agnostic contract so a consumer needs one import.
export * from '@gjsify/devtools-protocol';
