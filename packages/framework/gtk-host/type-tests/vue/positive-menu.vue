<!-- A menu written as a value (ADR 0042), in the Vue dialect.

     `:menu-model` is the kebab binding of the same widened property the JSX surface
     takes; `GtkMenuButton` is the GType key Volar resolves both spellings against. -->
<template>
    <GtkMenuButton
        icon-name="open-menu-symbolic"
        :menu-model="[
            { label: 'Preferences', action: 'app.preferences' },
            { section: [{ label: 'About', action: 'app.about' }] },
        ]"
    />
</template>
