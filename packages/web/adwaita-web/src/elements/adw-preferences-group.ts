// <adw-preferences-group> — Groups child rows in a boxed list with a title label.

export class AdwPreferencesGroup extends HTMLElement {
    connectedCallback() {
        const title = this.getAttribute('title') || '';
        const children = Array.from(this.childNodes);

        // Build header with title
        const header = document.createElement('div');
        header.className = 'adw-preferences-group-header';
        const titleEl = document.createElement('span');
        titleEl.className = 'adw-preferences-group-title';
        titleEl.textContent = title;
        header.appendChild(titleEl);

        // Build boxed list container and move children into it
        const listbox = document.createElement('div');
        listbox.className = 'adw-preferences-group-listbox';
        children.forEach(child => listbox.appendChild(child));

        this.appendChild(header);
        this.appendChild(listbox);
    }
}

customElements.define('adw-preferences-group', AdwPreferencesGroup);
