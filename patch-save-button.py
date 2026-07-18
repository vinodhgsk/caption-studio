import sys

with open('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

for i, line in enumerate(lines):
    if "import { useUserPresetStore } from '@/store/userPresetStore'" in line:
        lines.insert(i + 1, "import { clipTextToPresetStyle } from '../../../shared/userPreset'")
        break

start_idx = -1
for i, line in enumerate(lines):
    if '</select>' in line:
        # Check if the next line is </label>
        if i + 1 < len(lines) and '</label>' in lines[i+1]:
            start_idx = i + 1
            break

if start_idx != -1:
    button_jsx = """      <div className="mt-3 flex justify-end">
        <button
          onClick={() => {
            const name = window.prompt('Enter name for new custom style:', 'My Custom Style')
            if (!name) return
            const presetId = crypto.randomUUID()
            const text = captionClips[0]?.text
            const animation = captionClips[0]?.animation ?? {}
            const store = useUserPresetStore.getState()
            store.savePreset({
              id: presetId,
              name,
              createdAt: new Date().toISOString(),
              style: clipTextToPresetStyle(text),
              animation,
              variants: {}
            }).then(() => {
              applyCaptionPreset(presetId)
            })
          }}
          disabled={running || !hasCaptionTrack}
          className="text-xs font-medium text-blue-500 hover:text-blue-400 disabled:opacity-50"
        >
          + Save as custom style
        </button>
      </div>"""
    lines.insert(start_idx + 1, button_jsx)

with open('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("AutoCaptionPanel patched with button.")
