// Registers: MutationObserver, ResizeObserver, IntersectionObserver

import { IntersectionObserver } from '../intersection-observer.js';
import { MutationObserver } from '../mutation-observer.js';
import { ResizeObserver } from '../resize-observer.js';
import { defineGlobal } from './helpers.js';

defineGlobal('MutationObserver', MutationObserver);
defineGlobal('ResizeObserver', ResizeObserver);
defineGlobal('IntersectionObserver', IntersectionObserver);
