import { browser } from '@wxt-dev/browser';

import { COUNTS_KEY, type Counts } from '../messages.ts';

const title = document.getElementById('title') as HTMLHeadingElement;
const list = document.getElementById('hosts') as HTMLOListElement;
const empty = document.getElementById('empty') as HTMLParagraphElement;

title.textContent = browser.i18n.getMessage('popupTitle');
empty.textContent = browser.i18n.getMessage('popupEmpty');

const counts = ((await browser.storage.local.get(COUNTS_KEY))[COUNTS_KEY] ?? {}) as Counts;
const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
empty.hidden = rows.length > 0;
for (const [host, count] of rows) {
    const item = document.createElement('li');
    item.textContent = `${host}: ${count}`;
    list.append(item);
}
