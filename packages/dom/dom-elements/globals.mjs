/**
 * Native DOM globals for browser builds: the resolver routes `@gjsify/dom-elements` here on
 * `--app browser` because `package.json#gjsify.runtimes.browser` is `"native"`. There is no Node
 * counterpart — `runtimes.node` is `"none"`, Node having no DOM.
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
