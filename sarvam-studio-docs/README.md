# .antigravity — Caption Studio Knowledge Repository

This is the **knowledge repository** for Caption Studio (the Indic-first, lyrics-driven music-video
caption editor). It is *not* application code — it is the governed, machine-readable knowledge that
describes the product, the engineering platform, the AI build factory, governance, and operations.

## What changed (rebuild v2)
The previous `.antigravity/` was an over-scoped "enterprise factory" that was ~93% empty stubs, had no
machine-readable data, contained a Mermaid standard that contradicted its own draw.io decision, and
duplicated content across `authoritative/` and `archive/`. This rebuild is **right-sized to this product**
and **correct-by-construction**:
- Every file has real content (a validation gate rejects stubs < 200 bytes).
- Single source of truth — no duplicated trees.
- **draw.io is the only diagram standard** — real `.drawio` files are present; **no Mermaid** anywhere
  (the gate fails the build if a `.mmd`/`.mermaid` file or a ```mermaid fence appears).
- Structured, compilable descriptors: every domain has a `package.meta.json`; the whole repo is indexed
  by `registry/registry.json` and `registry/knowledge-graph.json`.
- Consistent naming: `NNN_snake_case` domains + docs; infra dirs (`registry/schemas/scripts/diagrams`) unnumbered.

## Layout
```
STANDARD.md                 the Knowledge Package standard (governing spec)
INDEX.md / KNOWLEDGE_MAP.md  navigation (INDEX is the real navigation, not filename ordinals)
registry/                   registry.json + knowledge-graph.json (machine-readable backbone)
schemas/                    JSON Schemas for package.meta.json + manifests
scripts/validate.mjs        the standard-enforcement gate (run: node .antigravity/scripts/validate.mjs)
diagrams/                   shared .drawio
000_foundation/             charter, principles, naming, docs-as-code, diagram standard, ADRs, glossary
100_product_captioning/     the product knowledge (captioning, Indic/Tamil, forced alignment, styles)
200_engineering/            Electron architecture, project model, storage, export parity, testing
300_ai_factory/             the agent/skill/command/hook + autopilot pipeline that builds the product
400_governance/             governance, quality gates, security, production readiness, traceability
500_operations/             observability, release, packaging/deployment
```

## The rule that keeps it honest
`node .antigravity/scripts/validate.mjs` must exit 0. It enforces: every domain has a valid
`package.meta.json`, no dependency cycles, registry ↔ folders agree, no stubs, and no Mermaid. Wire it
into CI so the standard is enforced, not merely stated.
