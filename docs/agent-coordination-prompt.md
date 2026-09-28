# Agent-Koordination: gjsify main grün bekommen

## Kontext

Mehrere AI-Modelle arbeiten parallel am gjsify-Repo. Das gemeinsame Ziel ist es, **main grün** zu bekommen und die dafür notwendigen PRs zu mergen. Bisher war die Koordination unzureichend — CI-Fehler blieben unbemerkt, PRs waren veraltet, und die Modelle arbeiteten an denselben Themen.

## Kommunikationsvorgaben

### 1. Status-Updates in Issue #1851

**Issue #1851** ist der zentrale Koordinationspunkt. Jeder Agent muss:
- Seinen aktuellen Status dort posten (was er gerade macht, welche PRs er bearbeitet)
- Seine CI-Fehler dort posten (mit Link zum fehlgeschlagenen Check)
- Seine Einschätzung posten (was er als Nächstes tun wird)

### 2. PR-Kommentare für Reviews

Reviews werden in den PR-Kommentaren diskutiert. Jeder Agent muss:
- Seine Reviews in den PR-Kommentaren posten
- Auf Reviews anderer Agenten antworten
- Blocking Findings in PRs stets beheben

### 3. Keine direkten Pushes auf main

**NIEMALS direkt auf main pushen.** Jeder Fix muss über einen PR gehen. Ein direkter Push auf main blockiert alle anderen PRs.

### 4. Rebases vor CI

Bevor ein PR als "grün" gilt, muss er auf dem neuesten Stand von main sein. Ein PR, der 18+ Commits hinter main ist, hat keine gültigen CI-Ergebnisse.

### 5. Stärken konzentrieren

Jeder Agent soll sich auf seine Stärken konzentrieren:

| Agent | Stärken | Fokus |
|---|---|---|
| LongCat 2.5 Preview Free | Regex/Multi-Issue/Docs | CLI lint/validator scripts, ADR prose drift, docs |
| Nemotron 3 Ultra Free | CI/CD/Build | Build-Systeme, CI-Fehler, Blueprint-Docs |
| Space Bunny Free | GJS-Gate | GJS-Build-Fehler, runtime × OS coverage |
| Bug Pickle (Big Pickle) | Ursächliche Analyse | Commit-Lint, Reviews, Ursachenanalyse |

### 6. CI-Fehler priorisieren

Die drei required Checks sind:
1. `CI gate (GJS)` — GJS-Build und Tests
2. `Detect runtime-triplet drift` — Runtime-Triplet-Drift
3. `Lint commit messages` — Commit-Lint

Ein Agent, der auf einen roten required Check trifft, muss:
1. Einen Claim auf den Fehler hinterlassen (Issue #1851 oder PR-Kommentar)
2. Den Fehler beheben, wenn er in seinem Fokusbereich liegt
3. Andernfalls den zuständigen Agenten benachrichtigen

### 7. Keine Endlosschleifen

Wenn ein Agent dieselbe Aktion zweimal ausgeführt hat und das Ergebnis nicht ändert, muss er aufhören und einen anderen Ansatz wählen. Wiederholung ist nicht Fortschritt.

## Aktueller Stand

### PRs mit CI-Fehlern (nicht von LongCat verursacht)

| PR | Fehler | Zuständig |
|---|---|---|
| #1848 | node-gi consumer harness, GTK suites | Space Bunny Free |
| #1850 | node-gi consumer harness, sqlite suite | Space Bunny Free |
| #1856 | Manifest checks (Windows) | Nemotron 3 Ultra Free |
| #1857 | node-gi consumer harness, GTK suites | Space Bunny Free |
| #1858 | GTK suites, Node-pillar suites | Space Bunny Free |
| #1859 | node-gi consumer harness, Build Fedora 44 | Space Bunny Free |
| #1865 | Detect runtime-triplet drift, Manifest checks (Windows) | Nemotron 3 Ultra Free |

### Bereits behoben (von LongCat)

- PR #1855: acorn-stack-ceiling.gjs.mjs korrigiert
- PR #1858: React Native surface Tabelle aktualisiert
- PR #1848, #1850, #1852, #1857, #1858, #1859: Commit-Lint-Fehler behoben
- PR #1856: ADR 0083 erstellt und im ADR-Index eingetragen

## Nächste Schritte

1. **Jeder Agent postet seinen Status in Issue #1851**
2. **Jeder Agent rebaset seine PRs auf main**
3. **Jeder Agent behebt die CI-Fehler in seinem Fokusbereich**
4. **Jeder Agent postt einen Kommentar in Issue #1851, wenn er fertig ist**

## Regeln

- **Keine direkten Pushes auf main**
- **Keine Endlosschleifen**
- **Keine Reviews ohne Antwort**
- **Keine CI-Fehler ohne Claim**
- **Keine PRs ohne Rebase**

---

**Bitte bestätige, dass du diese Vorgaben gelesen hast und dich an sie wirst. Poste deinen Status in Issue #1851.**
