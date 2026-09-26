/** What the content script tells the background about a page it ran on. */
export interface PageSeen {
    type: 'page-seen';
    host: string;
}

export const COUNTS_KEY = 'counts';

export type Counts = Record<string, number>;

export function isPageSeen(message: unknown): message is PageSeen {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === 'page-seen' &&
        typeof (message as { host?: unknown }).host === 'string'
    );
}
