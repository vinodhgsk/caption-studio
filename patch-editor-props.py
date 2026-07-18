import sys

with open('src/renderer/routes/Editor.tsx', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

for i, line in enumerate(lines):
    if "  const timelineLayout = useEditorStore((s) => s.timelineLayout)" in line:
        lines.insert(i + 1, "  const setTimelineLayout = useEditorStore((s) => s.setTimelineLayout)")
        break

for i, line in enumerate(lines):
    if "        onRedo={() => redo()}" in line:
        lines.insert(i + 1, "        timelineLayout={timelineLayout}")
        lines.insert(i + 2, "        onToggleLayout={() => setTimelineLayout(timelineLayout === 'full-width' ? 'docked' : 'full-width')}")
        break

with open('src/renderer/routes/Editor.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("Editor.tsx props patched successfully.")
