import sys

with open('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

for i, line in enumerate(lines):
    if "import { useTimelineStore } from '@/store/timelineStore'" in line:
        lines.insert(i + 1, "import { useUserPresetStore } from '@/store/userPresetStore'")
        break

start_idx = -1
for i, line in enumerate(lines):
    if 'const { applyCaptionPreset, running } = useTimelineStore()' in line:
        lines.insert(i + 1, "  const { presets: userPresets, loadPresets } = useUserPresetStore()")
        lines.insert(i + 2, "  useEffect(() => { loadPresets() }, [loadPresets])")
        break

select_start = -1
for i, line in enumerate(lines):
    if '<select' in line and 'value={activePresetId}' in lines[i+2]:
        select_start = i
        break

select_end = -1
if select_start != -1:
    for i in range(select_start, len(lines)):
        if '</select>' in lines[i]:
            select_end = i
            break

if select_start != -1 and select_end != -1:
    new_select = """        <select
          aria-label="Caption style preset"
          value={activePresetId}
          disabled={running || !hasCaptionTrack}
          onChange={(e) => applyCaptionPreset(e.target.value)}
          className="w-44 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
        >
          <optgroup label="Inbuilt styles">
            {captionPresets.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </optgroup>
          {userPresets.length > 0 && (
            <optgroup label="Custom styles">
              {userPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
        </select>"""
    del lines[select_start:select_end+1]
    lines.insert(select_start, new_select)

with open('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("AutoCaptionPanel dropdown patched successfully.")
