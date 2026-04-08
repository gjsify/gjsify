// Side-effect module: registers Blob/File as globals on GJS. On Node.js 18+
// these are native; the alias layer maps this subpath to @gjsify/empty for
// Node builds.

import { registerGlobal } from '@gjsify/utils';
import { Blob, File } from './blob.js';

registerGlobal('Blob', Blob);
registerGlobal('File', File);
