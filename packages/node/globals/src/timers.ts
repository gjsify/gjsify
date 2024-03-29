/*! (c) 2017 Andrea Giammarchi - @WebReflection (ISC) https://github.com/cgjs/cgjs/blob/master/packages/cgjs/cgjs/timers.js */
import imports from '@gjsify/types/index';
const mainloop = imports.mainloop;
// const cgjsloop = imports.cgjs.mainloop;

const ids = new Set();

// https://github.com/cgjs/cgjs/blob/master/packages/cgjs/cgjs/mainloop.js
const idle = (fn, ...args: any[]) => {
    // this.wait();
    return mainloop.idle_add(() => {
      // this.go();
      fn.apply(null, args);
    }, 0);
  };

const clearID = (id: number) => {
    if (ids.has(id)) {
        ids.delete(id);
        // cgjsloop.go();
        mainloop.source_remove(id);
    }
};

const createClearTimer = () => (id: number) => clearID(id);
const createSetTimer = (repeat: boolean) =>
    (fn, ms: number, ...args: any[]) => {
        const id = mainloop.timeout_add(
            (ms * 1) || 0,
            () => {
                if (!repeat) clearID(id);
                fn.apply(null, args);
                return repeat;
            },
            0
        );
        // cgjsloop.wait();
        ids.add(id);
        return id;
    };

    
export const clearImmediate = createClearTimer();
export const clearInterval = createClearTimer();
export const clearTimeout = createClearTimer();

export const setImmediate = (fn, ...args: any[]) => {
    const id = idle(fn, ...args);
    ids.add(id);
    return id;
};
export const setInterval = createSetTimer(true);
export const setTimeout = createSetTimer(false);

export default {
    clearImmediate,
    clearInterval,
    clearTimeout,
    setImmediate,
    setInterval,
    setTimeout,
}