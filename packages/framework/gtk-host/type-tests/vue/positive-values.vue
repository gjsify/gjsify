<!-- A list and a range written as values (ADR 0046, ADR 0047), in the Vue dialect —
     the siblings of `positive-menu.vue` on the same ParamSpec seam.

     `:model` and `:adjustment` are the kebab bindings of the same widened properties
     the JSX surface takes; `AdwComboRow` and `AdwSpinRow` are the GType keys Volar
     resolves both spellings against. -->
<template>
    <AdwPreferencesGroup>
        <AdwComboRow title="Accent colour" :model="['Blue', 'Teal']" :selected="1" />
        <AdwSpinRow title="Font size" :adjustment="{ lower: 0, upper: 100, value: 16 }" />
    </AdwPreferencesGroup>
</template>
