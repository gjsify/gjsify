import { run } from '@gjsify/unit';

import desktopEntrySuite from './desktop-entry.spec.js';
import refusalSuite from './refusal.spec.js';
import stubSuite from './stub.spec.js';
import wishSuite from './wish.spec.js';

run({ desktopEntrySuite, wishSuite, refusalSuite, stubSuite });
