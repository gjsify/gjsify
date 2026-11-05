import { readHints } from './hints.js';
import { detectVisitorPlatform } from './platform.js';

/**
 * The install block of the extension page lists every browser the extension is built for. This puts
 * the visitor's own browser first, where the stylesheet makes the first entry the large button, so
 * the markup stays complete and usable without it.
 */
class ExtensionInstall extends HTMLElement {
    connectedCallback(): void {
        const list = this.querySelector('ul');
        if (!list) return;
        void readHints().then((hints) => {
            const { browser } = detectVisitorPlatform(hints);
            const mine = browser && list.querySelector<HTMLElement>(`:scope > li[data-browser="${browser}"]`);
            if (!mine) return;
            mine.dataset.detected = 'true';
            list.prepend(mine);
        });
    }
}

customElements.define('extension-install', ExtensionInstall);
