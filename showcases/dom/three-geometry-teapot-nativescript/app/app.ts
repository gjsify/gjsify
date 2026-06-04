// Must be the FIRST import: installs the DOM shims (ImageData, Image, document, …)
// that three.js expects, on top of @nativescript/canvas's native surface.
import '@nativescript/canvas-polyfill';
import { Application } from '@nativescript/core';

Application.run({ moduleName: 'app-root' });

/*
Do not place any code after the application has been started as it will not
be executed on iOS.
*/
