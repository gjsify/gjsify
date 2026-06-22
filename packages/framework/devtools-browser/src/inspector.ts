// Inspector-data expression builders (devtools "Tier B") — original implementation.
//
// Pure JS-expression strings handed to IFrameBridge.evaluateJavaScript, the same
// headless-testable pattern as @gjsify/iframe's dom-queries. They return the data
// the WebKit Web Inspector panels show — Elements / Computed / Box Model (via
// getComputedStyle + getBoundingClientRect), the DOM tree, Network (Resource
// Timing API), and an approximate accessibility tree — without the remote
// inspector protocol (that's the heavier Tier C). Selectors are JSON.stringify'd
// so they can't break out of the generated expression.

/** Per-side edge sizes (px), as the Box Model panel shows them. */
export interface BoxEdges {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** The Box Model panel for an element. */
export interface BoxModel {
    margin: BoxEdges;
    border: BoxEdges;
    padding: BoxEdges;
    /** Content-box size (border-box minus border + padding). */
    content: { width: number; height: number };
}

/** What `inspect_element` returns — the Elements + Computed + Box Model panels. */
export interface InspectedElement {
    found: boolean;
    tagName?: string;
    id?: string;
    className?: string;
    attributes?: Record<string, string>;
    text?: string;
    rect?: { x: number; y: number; width: number; height: number };
    boxModel?: BoxModel;
    computedStyle?: Record<string, string>;
}

/** A node in the DOM tree dump. */
export interface DomNode {
    tagName: string;
    id: string;
    className: string;
    childElementCount: number;
    children?: DomNode[];
    /** Number of children omitted past the cap. */
    truncated?: number;
}

/** A node in the approximate accessibility tree. */
export interface AccessibilityNode {
    tagName: string;
    role: string;
    name: string;
    aria?: Record<string, string>;
    children?: AccessibilityNode[];
}

/** A Resource-Timing entry (the Network panel). */
export interface NetworkEntry {
    name: string;
    initiatorType: string;
    duration: number;
    transferSize: number;
    decodedBodySize: number;
    startTime: number;
}

/** The default curated computed-style properties (the most useful Computed-panel subset). */
const DEFAULT_STYLE_PROPS = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'width',
    'height',
    'box-sizing',
    'margin',
    'padding',
    'border',
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'text-align',
    'flex-direction',
    'justify-content',
    'align-items',
    'gap',
    'z-index',
    'opacity',
    'overflow',
    'visibility',
];

/**
 * Expression: inspect the first element matching `selector` → tag/id/class +
 * attributes + bounding rect + box model (margin/border/padding/content) +
 * a curated set of computed styles. Returns `{found:false}` when nothing matches.
 */
export function buildInspectElementExpression(
    selector: string,
    styleProps: readonly string[] = DEFAULT_STYLE_PROPS,
): string {
    const sel = JSON.stringify(selector);
    const props = JSON.stringify(styleProps);
    return (
        '(function(){' +
        `var el=document.querySelector(${sel});` +
        'if(!el)return {found:false};' +
        'var cs=getComputedStyle(el);var r=el.getBoundingClientRect();' +
        'function px(v){return parseFloat(v)||0;}' +
        'function edges(p){return {top:px(cs[p+"Top"]),right:px(cs[p+"Right"]),bottom:px(cs[p+"Bottom"]),left:px(cs[p+"Left"])};}' +
        'var border={top:px(cs.borderTopWidth),right:px(cs.borderRightWidth),bottom:px(cs.borderBottomWidth),left:px(cs.borderLeftWidth)};' +
        'var attrs={};for(var i=0;i<el.attributes.length;i++){attrs[el.attributes[i].name]=el.attributes[i].value;}' +
        `var props=${props};var styles={};for(var j=0;j<props.length;j++){styles[props[j]]=cs.getPropertyValue(props[j]);}` +
        'return {found:true,tagName:el.tagName,id:el.id||"",' +
        'className:(typeof el.className==="string"?el.className:""),' +
        'attributes:attrs,text:(el.textContent||"").trim().slice(0,200),' +
        'rect:{x:r.x,y:r.y,width:r.width,height:r.height},' +
        'boxModel:{margin:edges("margin"),border:border,padding:edges("padding"),' +
        'content:{width:el.clientWidth-px(cs.paddingLeft)-px(cs.paddingRight),height:el.clientHeight-px(cs.paddingTop)-px(cs.paddingBottom)}},' +
        'computedStyle:styles};})()'
    );
}

/**
 * Expression: the DOM tree from `selector` (or `document.documentElement`) down
 * to `maxDepth`, with at most `maxChildren` children per node (excess noted as
 * `truncated`). Returns the Elements-tree shape.
 */
export function buildDomTreeExpression(selector?: string, maxDepth = 3, maxChildren = 50): string {
    const root = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.documentElement';
    const depth = Math.max(0, Math.floor(maxDepth));
    const cap = Math.max(1, Math.floor(maxChildren));
    return (
        '(function(){' +
        `var root=${root};if(!root)return null;` +
        'function node(el,d){' +
        'var o={tagName:el.tagName,id:el.id||"",className:(typeof el.className==="string"?el.className:""),childElementCount:el.childElementCount};' +
        'if(d>0){o.children=[];var kids=el.children;' +
        `for(var i=0;i<kids.length&&i<${cap};i++){o.children.push(node(kids[i],d-1));}` +
        `if(kids.length>${cap})o.truncated=kids.length-${cap};}` +
        'return o;}' +
        `return node(root,${depth});})()`
    );
}

/**
 * Expression: page network activity via the Resource Timing API — the navigation
 * entry + each loaded resource ({name, initiatorType, duration, sizes, startTime}).
 */
export function buildNetworkExpression(): string {
    return (
        '(function(){' +
        'var nav=performance.getEntriesByType("navigation")[0];' +
        'var res=performance.getEntriesByType("resource").map(function(e){' +
        'return {name:e.name,initiatorType:e.initiatorType,duration:Math.round(e.duration),' +
        'transferSize:e.transferSize||0,decodedBodySize:e.decodedBodySize||0,startTime:Math.round(e.startTime)};});' +
        'return {navigation:nav?{name:nav.name,duration:Math.round(nav.duration),' +
        'domContentLoaded:Math.round(nav.domContentLoadedEventEnd),loadEvent:Math.round(nav.loadEventEnd)}:null,' +
        'resources:res};})()'
    );
}

/**
 * Expression: an approximate accessibility tree from `selector` (or `body`) —
 * role + accessible name + aria-* per node, down to `maxDepth`. Standard-DOM
 * approximation of the inspector's Accessibility/Audit view (the true platform
 * a11y tree is not exposed to page JS).
 */
export function buildAccessibilityExpression(selector?: string, maxDepth = 4, maxChildren = 50): string {
    const root = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body';
    const depth = Math.max(0, Math.floor(maxDepth));
    const cap = Math.max(1, Math.floor(maxChildren));
    return (
        '(function(){' +
        `var root=${root};if(!root)return null;` +
        'function nm(el){return el.getAttribute("aria-label")||el.getAttribute("alt")||el.getAttribute("title")||(el.textContent||"").trim().slice(0,80);}' +
        'function node(el,d){' +
        'var o={tagName:el.tagName,role:el.getAttribute("role")||"",name:nm(el)};' +
        'var aria={};for(var i=0;i<el.attributes.length;i++){var a=el.attributes[i];if(a.name.indexOf("aria-")===0)aria[a.name]=a.value;}' +
        'if(Object.keys(aria).length)o.aria=aria;' +
        'if(d>0){var kids=el.children;var c=[];' +
        `for(var j=0;j<kids.length&&j<${cap};j++)c.push(node(kids[j],d-1));` +
        'if(c.length)o.children=c;}' +
        'return o;}' +
        `return node(root,${depth});})()`
    );
}
