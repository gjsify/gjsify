import { enhanceDialog } from './dialog.js';

/** The copy button is hidden in the markup: without JavaScript the IBAN is plain selectable text. */
function enhanceCopy(button: HTMLButtonElement): void {
    const label = button.querySelector('span');
    const text = label?.textContent ?? '';
    if (!navigator.clipboard) return;
    button.hidden = false;
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(button.dataset.copy ?? '');
        } catch {
            return;
        }
        if (label) label.textContent = button.dataset.done ?? text;
        setTimeout(() => {
            if (label) label.textContent = text;
        }, 2000);
    });
}

/**
 * The ways to support the project. On the support page the list is plain markup and only the copy
 * buttons need the script; a dialog is enhanced when a page still has one.
 */
class AppSupport extends HTMLElement {
    connectedCallback(): void {
        this.dataset.enhanced = 'true';
        const dialog = this.querySelector('dialog');
        if (dialog) enhanceDialog(dialog, this.querySelector('.support-cta'));
        for (const button of this.querySelectorAll<HTMLButtonElement>('.sepa-copy')) enhanceCopy(button);
    }
}

customElements.define('app-support', AppSupport);
