<!-- GTK's ARIA surface in the Vue dialect — the same grouped prop, bound as a value.

     Volar resolves `accessibility` against the GType key exactly as it resolves every
     generated property, and the object's own keys are excess-property checked there too
     (`negative-accessibility.vue` is the other side). `checked` is a GtkAccessibleTristate
     and `row-index` is a relation carrying an integer; neither is a property of GtkLabel. -->
<template>
    <GtkLabel label="Total" :accessibility="{ label: 'Total for the year', checked: 'mixed', 'row-index': 3 }" />
</template>
