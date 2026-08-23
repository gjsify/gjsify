export * from './types.js';
export { GtkHostError } from './errors.js';
export {
    adopt,
    createAnchor,
    createElement,
    createText,
    clearContainer,
    destroy,
    disconnectHandlers,
    firstChild,
    insert,
    isText,
    materialize,
    mountRoot,
    nextSibling,
    parentNode,
    prevSibling,
    remove,
    setElementText,
    setEventHandler,
    setProp,
    setSlot,
    setText,
} from './host.js';
export { addressOf, reorderMode } from './policies.js';
export { toSignalName, isEventProp } from './signals.js';
export {
    constructOnlyNames,
    isConstructOnly,
    isWritable,
    lookupEnumNick,
    paramSpecs,
    toPropertyName,
} from './props.js';
export { assertInjective, tagOf } from './tags.js';
export type {
    ElementChild,
    ElementChildren,
    JsxAttributes,
    RawSignalAttributes,
    SlotAttribute,
    VueAttributes,
    WithOnce,
} from './attrs.js';
export {
    clearRegistry,
    hasWidget,
    lookupWidget,
    nearestRegistered,
    registerWidget,
    registerWidgets,
    registeredTags,
} from './registry.js';
export {
    ADW_DESCRIPTORS,
    BUILTIN_DESCRIPTORS,
    CURATED_DESCRIPTORS,
    GENERATED_PROVENANCE,
    GENERATED_WIDGETS,
    GTK_DESCRIPTORS,
    mergeGenerated,
    registerBuiltinWidgets,
    tableProvenance,
} from './descriptors/index.js';
