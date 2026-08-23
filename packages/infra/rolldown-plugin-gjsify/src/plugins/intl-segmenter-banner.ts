// One-line banner that supplies `Intl.Segmenter` on a GJS built without it.
//
// THE INCIDENT — measured, not hypothetical. `gjsify ship`'s first CI leg on a
// bare `ubuntu-latest` (the one that exists to hand a `.deb` to a real `dpkg`)
// installed the shipped package, ran the binary, and got:
//
//     JS ERROR: TypeError: Intl.Segmenter is not a constructor
//
// Not an old runtime: that host had **gjs 1.88.1**, the same version as the
// Fedora container where everything passes. The difference is the ICU the two
// were built against, so a version number does not predict it — and the `.deb`
// this project ships declares `Depends: gjs >= 1.82`, which apt satisfies on
// that host. Install succeeds, program does not start: verbatim the failure
// class `depends.ts` was written to prevent, one layer below where it looks.
//
// WHY THE CLI NEEDS IT AT ALL, and why no application code is involved:
// `@gjsify/cli` → `yargs@18` → `string-width@7` → `get-east-asian-width`, which
// constructs a `Intl.Segmenter` AT MODULE SCOPE. It is the argument parser, so
// every command dies, `--help` included — reproduced locally by deleting
// `Intl.Segmenter` before importing the published bundle.
//
// WHAT THIS FALLBACK IS, AND IS NOT. It segments by CODE POINT, not by grapheme
// cluster, because a correct cluster algorithm is a Unicode table this banner
// cannot carry. Measured against native, via `string-width`:
//
//     'hello' 5→5   'あいう' 6→6   '🇩🇪' 2→2   'café' 4→4      (identical)
//     '👨‍👩‍👧‍👦'  2→8   '👍🏽'    2→4                            (over-counted)
//
// So ASCII, CJK, flags and combining accents are exact; ZWJ sequences and skin
// tone modifiers come out too wide. The cost is a misaligned column in terminal
// output containing those emoji. The cost of not having it is that nothing runs
// at all. It is installed ONLY when the constructor is missing, so on every GJS
// with a full ICU — every currently green CI leg — this line does nothing.
//
// Kept on a single line, like the sibling banners: the banner runs before any
// source-map-aware machinery, so a newline here shifts every bundle line by one.

export const GJS_INTL_SEGMENTER_STUB =
    'if(typeof Intl.Segmenter!=="function")Intl.Segmenter=class Segmenter{' +
    'constructor(){}' +
    'resolvedOptions(){return{locale:"en",granularity:"grapheme"}}' +
    'segment(input){const s=String(input);return{input:s,[Symbol.iterator]:function*(){' +
    'let i=0;for(const c of s){yield{segment:c,index:i,input:s};i+=c.length}}}}' +
    '};';
