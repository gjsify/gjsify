# Agent Handoff — Koordination über PRs und Issues

> **An den anderen Agenten:** Lies dieses Dokument und **benenne es danach um** (z.B. `docs/agent-handoff-read.md` oder `docs/agent-handoff-2026-09-28.md`). Nicht löschen — die Spur soll erhalten bleiben. Danach kommunizieren wir über **PR-Kommentare** und **Issues** — nicht über diese Datei.

## Warum PRs und Issues?

- **PRs** sind asynchron, überprüfbar und hinterlassen eine Spur. Ein PR pro Thema.
- **Issues** sind der Backlog. Ein Issue = ein abgeschlossenes, prüfbares Stück Arbeit.
- Wir teilen uns die Arbeit auf, indem wir uns **nicht dieselben Dateien/Branches** gleichzeitig anfassen.

## Aktueller Stand (28.09.2026)

### Meine PRs (LongCat 2.5 Preview Free)

| PR | Thema | Status |
|---|---|---|
| #1847 | format --check skip warning | OPEN — Commit-Lint korrigiert |
| #1848 | caller gate double quotes + re-export | OPEN — Commit-Lint korrigiert |
| #1849 | rule 10 export * | OPEN — Commit-Lint korrigiert |
| #1850 | ADR 0034 prose drifts | OPEN — Commit-Lint korrigiert |
| #1852 | lockfile range violation check | OPEN — **Review: blocking finding** (scope-blind walk, 51 false positives) |
| #1853 | analysis pass NODE_ENV default | OPEN — **Review: giNamespacesForRegister change needs test** |
| #1856 | ADR 0083 OS axis derived data | OPEN — **Review: gjsify.osDerived needs uncheckedFields entry** |
| #1857 | vector store path | OPEN |
| #1858 | spec-only seams own exports | OPEN |
| #1859 | deviceId constraint | OPEN — TS error fix + commit body korrigiert |

### Reviews erhalten (JumpLink)

- **PR #1852**: Lockfile walk ist scope-blind — transitive Auflösungen werden gegen Root-Deklaration geprüft. Fix: nur direkte Abhängigkeiten (Single-Segment `node_modules/<name>`) betrachten.
- **PR #1853**: `giNamespacesForRegister` Änderung ist ein Behaviour Change ohne Test. Fix: Test für `pkg/register/foo` (matched) und `pkg/other` (nicht mehr matched) hinzufügen.
- **PR #1856**: `gjsify.osDerived` ist ein neuer `gjsify.*` Schlüssel — `field-coverage` wird darauf scheitern. Fix: `uncheckedFields` Eintrag mit Grund hinzufügen.

### Rote main — bekannte Probleme

| PR | Thema | Status |
|---|---|---|
| #1820 | gamepad-native linux/win32 | OPEN |
| #1819 | gamepad-native darwin | OPEN |
| #1810 | https TLS certificate | OPEN |
| #1802 | darwin native missing dep error | OPEN |
| #1800 | win32 follow-ups | OPEN |
| #1796 | webgl HiDPI test | OPEN |
| #1791 | darwin prebuilds sab/webrtc | OPEN |
| #1789 | node-gi Mesa OpenGL win32 | DRAFT |

### Offene Issues (Backlog)

- **adwaita-web** (#1815–#1826): 12 Issues zu UI-Features (tooltips, wrapping, prefix slots, etc.)
- **format --check** (#1807): HTML/CSS/Markdown werden übersprungen
- **process-stub banner** (#1676): Banner erkennt sich selbst
- **caller gate** (#1535): verpasst double quotes + re-export
- **menu focus** (#1534): Property write während menu open — View-Datei nicht gefunden
- **Pressable** (#1454): Gtk.Button arrangement

### Branches des anderen Agenten (Blueprint-Docs)

Der andere Agent arbeitet an `docs/blueprint-*` Branches (corpus, counts, gallery, namespace, etc.). Diese sind **nicht** für mich — ich fasse sie nicht an.

## Koordinationsregeln

1. **Ein PR pro Thema.** Keine Mischungen aus unzusammenhängenden Fixes.
2. **Issues als Backlog.** Bevor du anfängst, erstelle ein Issue (oder kommentiere in einem bestehenden) und weise es dir zu.
3. **PR-Kommentare für Review.** Wenn du einen PR reviewst, kommentiere direkt im PR — nicht in Issues.
4. **Keine gleichen Dateien gleichzeitig.** Wenn du an einem PR arbeitest, der Dateien berührt, die ich auch anfasse, koordinieren wir uns über PR-Kommentare.
5. **Rote main nicht direkt pushen.** Arbeite auf Branches, öffne PRs.
6. **Dieses Dokument löschen** nach dem Lesen.

## Wie wir die Arbeit aufteilen

- **Ich** kümmere mich um: Infrastruktur, CI, Build-System, Node.js-Shims, Typen-Generierung.
- **Du** kümmerst um: Blueprint-Docs, adwaita-web UI, ADR-Korrekturen.
- **Überschneidungen** klären wir über PR-Kommentare.

## Nächste Schritte für den anderen Agenten

1. Dieses Dokument lesen und umbenennen.
2. Reviews auf PRs #1852, #1853, #1856 beantworten (blocking findings).
3. Einen PR für die Blueprint-Docs öffnen (oder bestehende PRs aktualisieren).
4. Mir im PR-Kommentar Bescheid geben, wenn du etwas merged hast oder wenn du etwas von mir brauchst.

---

*Erstellt: 2026-09-27 durch Agent 1 (Infrastruktur). Aktualisiert: 2026-09-28 durch LongCat 2.5 Preview Free.*
