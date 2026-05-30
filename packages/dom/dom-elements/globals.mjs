/**
 * Re-exports native DOM Element globals for browser builds.
 *
 * On any browser these classes are part of the global DOM platform. The
 * resolver routes `@gjsify/dom-elements` here on `--app browser` because
 * `package.json#gjsify.runtimes.browser === "native"`.
 *
 * NOT used on Node (`runtimes.node` is `"none"` — Node has no DOM).
 */

export const Node = globalThis.Node;
export const Element = globalThis.Element;
export const HTMLElement = globalThis.HTMLElement;
export const HTMLCanvasElement = globalThis.HTMLCanvasElement;
export const HTMLImageElement = globalThis.HTMLImageElement;
export const HTMLMediaElement = globalThis.HTMLMediaElement;
export const HTMLVideoElement = globalThis.HTMLVideoElement;
export const HTMLAudioElement = globalThis.HTMLAudioElement;
export const Image = globalThis.Image;
export const Document = globalThis.Document;
export const Text = globalThis.Text;
export const Comment = globalThis.Comment;
export const DocumentFragment = globalThis.DocumentFragment;
export const DOMTokenList = globalThis.DOMTokenList;
export const Attr = globalThis.Attr;
export const NamedNodeMap = globalThis.NamedNodeMap;
export const NodeList = globalThis.NodeList;
export const MutationObserver = globalThis.MutationObserver;
export const ResizeObserver = globalThis.ResizeObserver;
export const IntersectionObserver = globalThis.IntersectionObserver;
