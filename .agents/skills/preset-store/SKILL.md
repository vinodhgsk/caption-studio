---
name: preset-store
description: Save/list/apply/import/export reusable text-style presets with format-specific (9:16/16:9/1:1) variants and schema validation. Use for preset management.
---
# preset-store

## Preset schema
`{ id, name, thumb, style:{font,fill,stroke,shadow,effects,decoration}, animation:{in,out,loop}, variants:{ "16:9":{layout}, "9:16":{layout}, "1:1":{layout} } }`.

## Store
Persist to user-level config and/or bundle. `save(clip)→preset`, `apply(preset, target, aspect)`, `import(file)` (validate schema, reject unknown/unsafe fields), `export(preset)`.

## Variants
On apply, pick the variant matching project aspect to avoid cropping; fall back to nearest.
