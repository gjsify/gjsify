// Registers: matchMedia

import { matchMedia } from '../match-media.js';
import { defineGlobalIfMissing } from './helpers.js';

defineGlobalIfMissing('matchMedia', matchMedia);
