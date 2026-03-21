import * as esbuild from "esbuild";
export { esbuild };

import {
  equal,
  deepEqual as assertEquals,
  throws as assertThrows
} from 'assert'

const assert = (test: boolean) => {
  return equal(test, true);
}

export { assert, assertEquals, assertThrows }
