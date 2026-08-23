<!-- expect-error: TS2353 needs=strictTemplates — a property no widget carries.
     Written in KEBAB deliberately: Volar camelizes a template attribute before
     it looks the prop up (reported here as `nonsuchProp`), so the Vue half
     catches the hyphenated misspelling that the JSX half structurally cannot —
     see `../jsx/known-hole-hyphen.tsx`. -->
<template>
    <GtkBox nonsuch-prop="1" />
</template>
