# Enterprise Knowledge Package Standard (EKPS 2.0) — Caption Studio

The governing standard for this repository. Every domain is a **Knowledge Package**: the smallest
independently governed, versioned, machine-describable unit of knowledge.

## Principles (enforced, not aspirational)
1. **Knowledge is the primary asset**, and it is machine-readable. Prose `.md` is the human view; the
   `package.meta.json` + `registry/` are the compiler view.
2. **Single source of truth.** A fact lives in exactly one package. No duplicate trees.
3. **Docs-as-code.** Reviewed via PR, versioned with semver, changelogged.
4. **draw.io is the only diagram standard.** Diagrams are `.drawio` (mxGraph XML), VS Code Draw.io
   Integration compatible. Mermaid is prohibited.
5. **Compiler-ready.** Every package declares its identity, dependencies, and outputs as data.
6. **Validation is mandatory.** `scripts/validate.mjs` gates the repo; CI must run it.
7. **No stubs in the tree.** Placeholder files (< 200 bytes) fail validation; empty structure is not committed.

## A Knowledge Package MUST contain
- `package.meta.json` — conforms to `schemas/package.meta.schema.json` (id, name, version, status,
  owners, dependsOn[], provides[], diagrams[]).
- `README.md` — purpose, scope, boundaries.
- `INDEX.md` — the document list (the real navigation for the package).
- One or more `NNN_snake_case.md` content documents (real content).
A package MAY contain `diagrams/` (`.drawio`), `adr/` (decision records), `examples/`, `schemas/` —
only when they hold real content.

## Naming
- Domains and content docs: `NNN_snake_case` (3-digit zero-padded ID + snake_case).
- IDs are stable identifiers, NOT sort keys — navigation is via `INDEX.md` and the registry/graph.
- Infra directories are unnumbered: `registry/`, `schemas/`, `scripts/`, `diagrams/`.
- Well-known root files are UPPERCASE: README, INDEX, STANDARD, VERSION, CHANGELOG, KNOWLEDGE_MAP.

## Dependency rules
- `dependsOn` in `package.meta.json` declares edges. Direction flows one way (see KNOWLEDGE_MAP).
- Cycles are forbidden and detected by the gate.

## Change control
Semver per package (`package.meta.json.version`). Breaking a `provides[]` contract is a major bump.
Decisions are recorded as ADRs under `000_foundation/adr/` and referenced by `conformsTo` where relevant.
