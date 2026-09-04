<!-- expect-error: TS2353 — `menuModel` takes a LIST or a real Gio.MenuModel, and the
     ADR 0042 widening adds a union member rather than replacing the type. A bare
     descriptor is the mistake an author actually makes. -->
<template>
    <GtkMenuButton :menu-model="{ label: 'Preferences' }" />
</template>
