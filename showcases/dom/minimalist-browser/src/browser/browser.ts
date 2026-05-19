// Browser variant — DOM-based UI driving a real <iframe>.
//
// Exposes `mount(container, options?)` so the website slideshow can
// embed the showcase. Standalone runs through `browser-main.ts` which
// calls `mount(document.body)`.

import { BrowserCore, BUILTIN_PAGE_URLS, DEFAULT_HOME_URL } from '../browser-demo.js';

export interface MountOptions {
  /** Override the title in the header bar. */
  title?: string;
  /** Override the URL loaded on startup. */
  homeUrl?: string;
}

export interface ShowcaseHandle {
  pause(): void;
  resume(): void;
  readonly isPaused: boolean;
  navigate(url: string): void;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
  const title = options?.title ?? 'Minimalist Browser';
  const homeUrl = options?.homeUrl ?? DEFAULT_HOME_URL;

  // Build the shell — header bar + nav controls + iframe + status line.
  // Styles are inline so the showcase is self-contained; the website host
  // doesn't need to ship a sibling CSS file.
  const root = document.createElement('section');
  Object.assign(root.style, {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#fdfcfb', color: '#1d1c1a',
    fontFamily: 'system-ui, sans-serif',
  } as Partial<CSSStyleDeclaration>);

  const header = document.createElement('header');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 12px', borderBottom: '1px solid #d8d6cf',
    background: '#f3f1ea',
  } as Partial<CSSStyleDeclaration>);

  const headingEl = document.createElement('strong');
  headingEl.textContent = title;
  headingEl.style.color = '#4a5fb8';
  headingEl.style.marginRight = '12px';

  const backBtn = makeNavButton('←');
  backBtn.title = 'Back';
  const forwardBtn = makeNavButton('→');
  forwardBtn.title = 'Forward';
  const reloadBtn = makeNavButton('↻');
  reloadBtn.title = 'Reload';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.value = homeUrl;
  Object.assign(urlInput.style, {
    flex: '1', padding: '6px 10px',
    border: '1px solid #c0bdb4', borderRadius: '4px',
    fontSize: '14px', fontFamily: 'inherit',
    background: 'white', color: '#1d1c1a',
  } as Partial<CSSStyleDeclaration>);

  const goBtn = document.createElement('button');
  goBtn.textContent = 'Go';
  Object.assign(goBtn.style, {
    padding: '6px 16px', background: '#4a5fb8', color: 'white',
    border: 'none', borderRadius: '4px', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: '14px',
  } as Partial<CSSStyleDeclaration>);

  header.appendChild(headingEl);
  header.appendChild(backBtn);
  header.appendChild(forwardBtn);
  header.appendChild(reloadBtn);
  header.appendChild(urlInput);
  header.appendChild(goBtn);

  // Quick-nav row for built-in pages — handy on first launch.
  const quickNav = document.createElement('nav');
  Object.assign(quickNav.style, {
    display: 'flex', gap: '6px', flexWrap: 'wrap',
    padding: '6px 12px', borderBottom: '1px solid #d8d6cf',
    background: '#fafaf6', fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);
  const quickLabel = document.createElement('span');
  quickLabel.textContent = 'Quick nav:';
  quickLabel.style.color = '#6a6962';
  quickLabel.style.alignSelf = 'center';
  quickNav.appendChild(quickLabel);
  for (const url of BUILTIN_PAGE_URLS) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = url;
    a.style.color = '#4a5fb8';
    a.style.textDecoration = 'none';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      core.navigate(url);
    });
    quickNav.appendChild(a);
  }

  // The iframe content area — a real <iframe> in the browser variant.
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    flex: '1', border: 'none', width: '100%',
    background: 'white',
  } as Partial<CSSStyleDeclaration>);
  // Sandbox: allow scripts so built-in page templates can postMessage.
  iframe.setAttribute('sandbox', 'allow-scripts');

  // Status line — surfaces the postMessage round-trip outcome.
  const status = document.createElement('footer');
  Object.assign(status.style, {
    padding: '6px 12px', borderTop: '1px solid #d8d6cf',
    background: '#f3f1ea', fontSize: '12px', color: '#6a6962',
    fontFamily: 'monospace',
  } as Partial<CSSStyleDeclaration>);
  status.textContent = 'Status: idle';

  root.appendChild(header);
  root.appendChild(quickNav);
  root.appendChild(iframe);
  root.appendChild(status);
  container.appendChild(root);

  // Wire the core.
  const core = new BrowserCore(iframe as unknown as import('../browser-demo.js').IFrameHandle);
  let paused = false;

  core.onStateChange((state) => {
    if (paused) return;
    urlInput.value = state.url;
    backBtn.disabled = !state.canGoBack;
    forwardBtn.disabled = !state.canGoForward;
  });

  core.onPageLoaded((info) => {
    if (paused) return;
    status.textContent = `Status: loaded "${info.title}" (${info.url})`;
  });

  function submitUrl(): void {
    const value = urlInput.value.trim();
    if (value) core.navigate(value);
  }
  goBtn.addEventListener('click', submitUrl);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUrl(); });
  backBtn.addEventListener('click', () => core.back());
  forwardBtn.addEventListener('click', () => core.forward());
  reloadBtn.addEventListener('click', () => core.reload());

  // Initial navigation.
  core.navigate(homeUrl);

  return {
    pause(): void { paused = true; },
    resume(): void { paused = false; },
    get isPaused(): boolean { return paused; },
    navigate(url: string): void { core.navigate(url); },
  };
}

function makeNavButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  Object.assign(btn.style, {
    padding: '6px 12px', background: '#e6e4dc', color: '#1d1c1a',
    border: '1px solid #c0bdb4', borderRadius: '4px',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: '16px',
    minWidth: '36px',
  } as Partial<CSSStyleDeclaration>);
  return btn;
}
