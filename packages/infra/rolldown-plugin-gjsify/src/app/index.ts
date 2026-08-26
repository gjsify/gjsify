export { setupForGjs, isRegisterSubpath, isGjsifyShim, createGjsExternalsPredicate } from './gjs.js';
export type { GjsBuildConfig, GjsFactoryInput } from './gjs.js';
export { setupForNode, enableGjsRegistersForNode, isGjsSourceBuild } from './node.js';
export type { NodeBuildConfig, NodeFactoryInput } from './node.js';
export { setupForBrowser } from './browser.js';
export type { BrowserBuildConfig, BrowserFactoryInput } from './browser.js';
export { setupForNativescript } from './nativescript.js';
export type { NativescriptBuildConfig, NativescriptFactoryInput } from './nativescript.js';
