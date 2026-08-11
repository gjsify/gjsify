// The storybook and the devtools agent are set up in the page code-behind (storybook-page.ts, on
// first navigation), where the storybook controller exists.

import { Application } from '@nativescript/core';

Application.run({ moduleName: 'app-root' });

/*
Do not place any code after the application has been started as it will not
be executed on iOS.
*/
