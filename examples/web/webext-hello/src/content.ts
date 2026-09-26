import { browser } from '@wxt-dev/browser';

import type { PageSeen } from './messages.ts';

const message: PageSeen = { type: 'page-seen', host: location.host };
void browser.runtime.sendMessage(message);
