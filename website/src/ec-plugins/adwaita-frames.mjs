// Expressive Code plugin: restructures @expressive-code/plugin-frames output into
// Adwaita window chrome (adw-window + adw-header-bar) in postprocessRenderedBlock.

/** @import { ExpressiveCodePlugin } from '@expressive-code/core' */
import { h } from '@expressive-code/core/hast';

/**
 * Depth-first search for the first element with this tag name and class.
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

// Client-side JS module: Adwaita copy-feedback toast, shown inside the
// .adw-code-window frame.
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

// Fallback window titles by language: every block renders the Adwaita chrome, so
// an untitled block would show an empty headerbar. An explicit `title="…"` wins.
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
    vue: 'Vue',
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

/** @returns {ExpressiveCodePlugin} */
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

                if (
                    frame.type !== 'element' ||
                    frame.tagName !== 'figure' ||
                    !frame.properties?.className?.includes('frame')
                ) {
                    return;
                }

                frame.properties.className.push('adw-code-window');

                const header = findElement(frame, 'figcaption', 'header');
                if (!header) return;

                const titleEl = findElement(header, 'span', 'title');
                const copyDiv = findElement(frame, 'div', 'copy');

                header.properties.className.push('adw-code-headerbar');

                // Empty start spacer, so the title stays centred.
                const startSpacer = h('div', { className: ['adw-code-headerbar-start'] });

                // Terminal frames carry a title span holding an EMPTY text node, so
                // test for actual text rather than for children.
                const hasText = (node) =>
                    node?.type === 'text' ? node.value.trim().length > 0 : (node?.children ?? []).some(hasText);
                const hasTitle = titleEl != null && titleEl.children.some(hasText);
                const fallbackTitle = DEFAULT_FRAME_TITLES[codeBlock?.language ?? ''] ?? 'Code';
                const titleSpan = h(
                    'span',
                    { className: ['adw-code-headerbar-title'] },
                    hasTitle ? titleEl.children : [{ type: 'text', value: fallbackTitle }],
                );

                // Keep the 'copy' class: EC's own client JS finds the button through
                // `.expressive-code .copy button` to attach its click handler.
                const endChildren = copyDiv ? [...copyDiv.children] : [];
                const endSection = h('div', { className: ['adw-code-headerbar-end', 'copy'] }, endChildren);

                header.children = [startSpacer, titleSpan, endSection];

                // Its children moved into the header above, so drop the original.
                if (copyDiv) {
                    frame.children = frame.children.filter((c) => c !== copyDiv);
                }
            },
        },
    };
}
