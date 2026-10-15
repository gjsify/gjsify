import { enhanceDialog } from './dialog.js';
import { detectVisitorPlatform, inGroup, recommendTarget, type Platform, type PlatformHints } from './platform.js';
import type { TargetArch, TargetPlatform } from '../site-data/types.js';

/** The parts of `navigator.userAgentData` this page uses; it is absent outside Chromium. */
interface UserAgentData {
    platform?: string;
    brands?: Array<{ brand: string }>;
    getHighEntropyValues?(hints: string[]): Promise<{ architecture?: string; bitness?: string }>;
}

/** One rendered download row. Everything here was translated at build time. */
interface Row {
    os: TargetPlatform;
    arch: TargetArch;
    recommended: boolean;
    url: string;
    cta: string;
    size: string;
}

async function readHints(): Promise<PlatformHints> {
    const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
    const hints: PlatformHints = {
        platform: data?.platform,
        userAgent: navigator.userAgent,
        brands: data?.brands?.map((entry) => entry.brand),
    };
    if (data?.getHighEntropyValues) {
        try {
            const high = await data.getHighEntropyValues(['architecture', 'bitness']);
            hints.architecture = high.architecture;
            hints.bitness = high.bitness;
        } catch {
            // The browser may refuse; `detectVisitorPlatform` then falls back to an assumed architecture.
        }
    }
    return hints;
}

function readRows(host: HTMLElement): Row[] {
    return [...host.querySelectorAll<HTMLElement>('li.target')].flatMap((item) => {
        const link = item.querySelector('a');
        const os = item.dataset.os as TargetPlatform | undefined;
        const arch = item.dataset.arch as TargetArch | undefined;
        if (!link || !os || !arch) return [];
        return [
            {
                os,
                arch,
                recommended: item.dataset.recommended !== undefined,
                url: link.href,
                cta: item.dataset.cta ?? link.textContent?.trim() ?? '',
                size: item.dataset.size ?? '',
            },
        ];
    });
}

/** The size badge belongs to the same fact row as the primary button, one level up in the hero. */
function showSize(size: string): void {
    const badge = document.querySelector<HTMLElement>('.badge-size');
    const value = badge?.querySelector('.badge-value');
    if (!badge || !value) return;
    value.textContent = size;
    badge.hidden = size === '';
    const facts = badge.closest<HTMLElement>('.badges');
    // Showing or hiding a fact changes how many columns the row needs.
    if (!facts) return;
    const count = [...facts.children].filter((item) => !(item as HTMLElement).hidden).length;
    facts.style.setProperty('--badge-count', String(count));
    facts.toggleAttribute('data-odd', count % 2 === 1);
}

/**
 * One part of the product in the dialog, with its own tab strip. The parts are independent: the
 * app is picked by the visitor's operating system and the extension it pairs with by their
 * browser, so each section decides which of its own tabs is open.
 */
class ComponentSection {
    readonly rows: Row[];
    private readonly groups: HTMLElement[];
    private readonly tabs: HTMLButtonElement[];
    private readonly tabBar: HTMLElement | null;
    /** A single tab names what the group heading already says; the strip only earns its place from two. */
    private readonly grouped: boolean;

    constructor(
        host: HTMLElement,
        /** Called with the row this section now offers, for the one section that drives the button. */
        private readonly onSelect: (row: Row) => void,
    ) {
        this.rows = readRows(host);
        this.groups = [...host.querySelectorAll<HTMLElement>('.os-group')];
        this.tabs = [...host.querySelectorAll<HTMLButtonElement>('.os-tab')];
        this.tabBar = host.querySelector<HTMLElement>('.os-tabs');
        this.grouped = this.tabs.length > 1;
        if (this.tabBar && this.grouped) this.tabBar.hidden = false;

        const preselected = this.tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.os as
            | TargetPlatform
            | undefined;
        if (preselected) this.show(preselected);

        for (const tab of this.tabs) {
            tab.addEventListener('click', () => {
                const os = tab.dataset.os as TargetPlatform | undefined;
                if (os) this.select(os, this.platform);
            });
        }

        this.tabBar?.addEventListener('keydown', (event) => {
            const current = this.tabs.indexOf(document.activeElement as HTMLButtonElement);
            if (current === -1) return;
            const last = this.tabs.length - 1;
            const step = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: last }[event.key];
            if (step === undefined) return;
            event.preventDefault();
            const tab = this.tabs[(step + this.tabs.length) % this.tabs.length];
            tab?.focus();
            tab?.click();
        });
    }

    private platform: Platform = { os: undefined, arch: undefined, browser: undefined, archAssumed: true };

    private show(os: TargetPlatform): void {
        for (const group of this.groups) group.hidden = this.grouped && group.dataset.os !== os;
        for (const tab of this.tabs) {
            const selected = tab.dataset.os === os;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        }
    }

    /** Opens the tab for `os` and reports the row it recommends for the visitor inside that group. */
    private select(os: TargetPlatform, platform: Platform): void {
        this.show(os);
        const row = recommendTarget(this.rows, inGroup(platform, os));
        if (row) this.onSelect(row);
    }

    /** Opens the tab this machine belongs to. The server's choice stands when nothing matched. */
    detected(platform: Platform): void {
        this.platform = platform;
        const row = recommendTarget(this.rows, platform);
        if (!row) return;
        this.show(row.os);
        this.onSelect(row);
    }
}

/**
 * Enhances the server-rendered download widget: the list of targets becomes a modal with one tab
 * per operating system (or browser), and the primary button is swapped for the build that fits this
 * machine. A product made of several parts gets one tab strip per part, and the button follows the
 * part that is installed first — the dialog's own order.
 * Nothing here invents a label — every string was rendered into a data attribute at build time.
 */
class AppDownload extends HTMLElement {
    connectedCallback(): void {
        const dialog = this.querySelector('dialog');
        const cta = this.querySelector<HTMLAnchorElement>('a.download-cta');
        if (!dialog || !cta) return;
        this.dataset.enhanced = 'true';
        enhanceDialog(dialog, this.querySelector('.download-toggle'));

        const offer = (row: Row): void => {
            cta.href = row.url;
            cta.dataset.os = row.os;
            cta.dataset.arch = row.arch;
            const label = cta.querySelector('.download-label');
            if (label) label.textContent = row.cta;
            showSize(row.size);
        };

        const hosts = [...this.querySelectorAll<HTMLElement>('section.component')];
        const sections = (hosts.length > 0 ? hosts : [this]).map(
            (host, index) => new ComponentSection(host, index === 0 ? offer : () => {}),
        );

        void readHints().then((hints) => {
            const platform = detectVisitorPlatform(hints);
            for (const section of sections) section.detected(platform);
        });
    }
}

customElements.define('app-download', AppDownload);
