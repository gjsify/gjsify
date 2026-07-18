// Expressive Code plugin: Adwaita-style code block frames.
// Restructures the frames plugin output to match adw-window + adw-header-bar.
// Runs after @expressive-code/plugin-frames in postprocessRenderedBlock.

/** @import { ExpressiveCodePlugin } from '@expressive-code/core' */
import { h } from '@expressive-code/core/hast';

/**
 * Find an element by tag name and class in a HAST tree (shallow + recursive).
 * @param {import('@expressive-code/core/hast').Element | null} parent
 * @param {string} tagName
 * @param {string} className
 * @returns {import('@expressive-code/core/hast').Element | null}
 */
function findElement(parent, tagName, className) {
    if (!parent?.children) return null;
    for (const child of parent.children) {
        if (
            child.type === 'element' &&
            child.tagName === tagName &&
            Array.isArray(child.properties?.className) &&
            child.properties.className.includes(className)
        ) {
            return child;
        }
        const found = findElement(child, tagName, className);
        if (found) return found;
    }
    return null;
}

/**
 * @returns {ExpressiveCodePlugin}
 */
// Client-side JS module: Adwaita toast for copy feedback.
// Shows toast inside the code window frame (relative to the adw-code-window).
const adwCopyToastModule = `
var _cssInjected = false;
function ensureCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  var s = document.createElement('style');
  s.textContent = [
    '/* Adwaita toast inside EC frame — needs !important to survive all:revert */',
    '.expressive-code .frame .adw-code-toast-overlay {',
    '  all: unset !important;',
    '  position: absolute !important;',
    '  bottom: 12px !important;',
    '  left: 50% !important;',
    '  transform: translateX(-50%) !important;',
    '  z-index: 10 !important;',
    '  display: flex !important;',
    '  flex-direction: column-reverse !important;',
    '  gap: 9px !important;',
    '  align-items: center !important;',
    '  pointer-events: none !important;',
    '}',
    '.expressive-code .frame .adw-code-toast {',
    '  all: unset !important;',
    '  display: flex !important;',
    '  align-items: center !important;',
    '  background-color: #3d3846 !important;',
    '  color: #ffffff !important;',
    '  padding: 9px 12px !important;',
    '  border-radius: 12px !important;',
    '  box-shadow: 0 2px 8px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.25) !important;',
    '  width: max-content !important;',
    '  max-width: 80% !important;',
    '  pointer-events: auto !important;',
    '  font-family: system-ui, sans-serif !important;',
    '  font-size: 0.9rem !important;',
    '  opacity: 0 !important;',
    '  transform: translateY(8px) !important;',
    '  transition: opacity 0.2s cubic-bezier(0,0,0.2,1), transform 0.2s cubic-bezier(0,0,0.2,1) !important;',
    '}',
    '.expressive-code .frame .adw-code-toast.visible {',
    '  opacity: 1 !important;',
    '  transform: translateY(0) !important;',
    '}',
    '.expressive-code .frame .adw-code-toast.hiding {',
    '  opacity: 0 !important;',
    '  transform: translateY(8px) !important;',
    '  transition-duration: 0.15s !important;',
    '  transition-timing-function: cubic-bezier(0.4,0,1,1) !important;',
    '}',
  ].join('\\n');
  document.head.appendChild(s);
}

function getOverlay(frame) {
  var ol = frame.querySelector('.adw-code-toast-overlay');
  if (!ol) {
    ensureCSS();
    ol = document.createElement('div');
    ol.className = 'adw-code-toast-overlay';
    frame.appendChild(ol);
  }
  return ol;
}

function showToast(frame, text, timeout) {
  if (timeout === undefined) timeout = 2000;
  var ol = getOverlay(frame);
  var t = document.createElement('div');
  t.className = 'adw-code-toast';
  t.textContent = text;
  ol.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('visible'); });
  setTimeout(function() {
    t.classList.remove('visible');
    t.classList.add('hiding');
    t.addEventListener('transitionend', function() { t.remove(); }, { once: true });
    setTimeout(function() { if (t.parentNode) t.remove(); }, 300);
  }, timeout);
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest && e.target.closest('.adw-code-headerbar-end button[data-code]');
  if (!btn) return;
  var frame = btn.closest('.frame.adw-code-window');
  if (!frame) return;
  showToast(frame, btn.getAttribute('data-copied') || 'Copied!');
});
`;

// Fallback window titles by code-block language — every block renders the
// Adwaita window chrome, so an untitled block would show an empty headerbar.
// An explicit ```lang title="…" in the content always wins.
const DEFAULT_FRAME_TITLES = {
    bash: 'Terminal',
    sh: 'Terminal',
    shell: 'Terminal',
    zsh: 'Terminal',
    console: 'Terminal',
    ansi: 'Terminal',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    javascript: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    json: 'JSON',
    jsonc: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    xml: 'XML',
    astro: 'Astro',
    md: 'Markdown',
    mdx: 'Markdown',
    diff: 'Diff',
    ini: 'Config',
    toml: 'Config',
    text: 'Text',
    txt: 'Text',
    plaintext: 'Text',
};

export function pluginAdwaitaFrames() {
    return {
        name: 'adwaita-frames',
        baseStyles: `
      /* Hide EC's feedback tooltip in our headerbar */
      .adw-code-headerbar-end .feedback { display: none !important; }
    `,
        jsModules: [adwCopyToastModule],
        hooks: {
            postprocessRenderedBlock: ({ codeBlock, renderData }) => {
                const frame = renderData.blockAst;

                // Only process frame elements generated by plugin-frames
                if (
                    frame.type !== 'element' ||
                    frame.tagName !== 'figure' ||
                    !frame.properties?.className?.includes('frame')
                ) {
                    return;
                }

                // Add our marker class
                frame.properties.className.push('adw-code-window');

                // Find header (figcaption.header)
                const header = findElement(frame, 'figcaption', 'header');
                if (!header) return;

                // Find title span inside header
                const titleEl = findElement(header, 'span', 'title');

                // Find copy button div
                const copyDiv = findElement(frame, 'div', 'copy');

                // Add our class to header
                header.properties.className.push('adw-code-headerbar');

                // Rebuild header children:
                // 1. Empty start spacer (for centering balance)
                const startSpacer = h('div', { className: ['adw-code-headerbar-start'] });

                // 2. Centered title — explicit title="…" wins, else a
                // language-derived default so the headerbar is never empty.
                // (Terminal frames carry a title span with an EMPTY text node,
                // so test for actual text, not just children.)
                const hasText = (node) =>
                    node?.type === 'text' ? node.value.trim().length > 0 : (node?.children ?? []).some(hasText);
                const hasTitle = titleEl != null && titleEl.children.some(hasText);
                const fallbackTitle = DEFAULT_FRAME_TITLES[codeBlock?.language ?? ''] ?? 'Code';
                const titleSpan = h(
                    'span',
                    { className: ['adw-code-headerbar-title'] },
                    hasTitle ? titleEl.children : [{ type: 'text', value: fallbackTitle }],
                );

                // 3. End section with copy button.
                // Keep 'copy' class so EC's client JS (.expressive-code .copy button)
                // can find the button and attach the click handler.
                const endChildren = copyDiv ? [...copyDiv.children] : [];
                const endSection = h('div', { className: ['adw-code-headerbar-end', 'copy'] }, endChildren);

                header.children = [startSpacer, titleSpan, endSection];

                // Remove original .copy div from frame (now in header)
                if (copyDiv) {
                    frame.children = frame.children.filter((c) => c !== copyDiv);
                }
            },
        },
    };
}
