import sys

with open('src/renderer/store/timelineStore.ts', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

for i, line in enumerate(lines):
    if "import { getCaptionPreset } from '../../shared/captionPresetRegistry'" in line:
        lines.insert(i + 1, "import { useUserPresetStore } from './userPresetStore'")
        lines.insert(i + 2, "import { resolveVariant } from '../../shared/userPreset'")
        break

start_idx = -1
for i, line in enumerate(lines):
    if 'applyCaptionPreset: (presetId) => {' in line:
        start_idx = i
        break

end_idx = -1
for i in range(start_idx, len(lines)):
    if 'useProjectStore.getState().runCommand(applyCaptionPresetCommand(project, preset))' in lines[i]:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_block = """  applyCaptionPreset: (presetId) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    // No Caption track → no-op (nothing to stamp the style onto).
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false

    // Check built-in registry
    let preset = getCaptionPreset(presetId)

    if (preset === undefined) {
      // Check user preset store
      const userPreset = useUserPresetStore.getState().presets.find((p) => p.id === presetId)
      if (userPreset) {
        const aspectKey = (project.settings.aspect ?? '9:16') as '9:16' | '16:9' | '1:1'
        const layout = resolveVariant(userPreset.variants, aspectKey)
        preset = {
          id: userPreset.id,
          displayName: userPreset.name,
          font: userPreset.style.font ?? { family: 'Inter', size: 144 },
          fill: userPreset.style.fill,
          stroke: userPreset.style.stroke,
          shadow: userPreset.style.shadow,
          effects: userPreset.style.effects,
          decoration: userPreset.style.decoration,
          animation: userPreset.animation,
          layout: layout
            ? {
                anchor: layout.anchor ?? 'center',
                y: layout.y,
                safeMargin: layout.safeMargin,
                maxLines: layout.maxLines,
                blockHeight: layout.blockHeight
              }
            : undefined
        } as any // cast needed if optional fields differ slightly
      }
    }

    if (preset === undefined) return false

    useProjectStore.getState().runCommand(applyCaptionPresetCommand(project, preset))"""
    
    del lines[start_idx:end_idx+1]
    lines.insert(start_idx, new_block)

with open('src/renderer/store/timelineStore.ts', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("timelineStore.ts patched successfully.")
