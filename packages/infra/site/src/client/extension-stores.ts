import { readHints } from './hints.js';
import { detectStore } from './platform.js';

/**
 * Marks the store link that fits the visitor's browser. It never navigates: the page they asked for
 * stays, and a crawler or a shared link sees the same thing a person does.
 */
class ExtensionStores extends HTMLElement {
    connectedCallback(): void {
        void readHints().then((hints) => {
            const store = detectStore(hints);
            if (!store) return;
            const link = this.querySelector<HTMLElement>(`a[data-store="${store}"]`);
            if (!link || link.getAttribute('aria-current')) return;
            link.dataset.suggested = 'true';
            link.querySelector<HTMLElement>('.ext-suggest')?.removeAttribute('hidden');
        });
    }
}

if (!customElements.get('extension-stores')) customElements.define('extension-stores', ExtensionStores);
