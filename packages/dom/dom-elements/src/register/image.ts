// Registers: Image, HTMLImageElement

import { HTMLImageElement } from '../html-image-element.js';
import { Image } from '../image.js';
import { defineGlobal } from './helpers.js';

defineGlobal('HTMLImageElement', HTMLImageElement);
defineGlobal('Image', Image);
