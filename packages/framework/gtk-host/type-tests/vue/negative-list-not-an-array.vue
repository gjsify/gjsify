<!-- expect-error: TS2353 — `model` takes a LIST or a real Gio.ListModel, and the
     ADR 0046 widening adds a union member rather than replacing the type. One
     descriptor where a list belongs is the mistake an author actually makes. -->
<template>
    <AdwComboRow :model="{ value: 'a', label: 'A' }" />
</template>
