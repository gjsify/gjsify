// Registers: location (file:// origin stub for GJS apps)

import { location } from '../location-stub.js';
import { defineGlobalIfMissing } from './helpers.js';

defineGlobalIfMissing('location', location);
