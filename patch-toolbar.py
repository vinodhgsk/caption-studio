import sys

with open('src/renderer/routes/editor/EditorToolbar.tsx', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

for i, line in enumerate(lines):
    if "onRedo: () => void" in line:
        lines.insert(i + 1, "  timelineLayout: 'docked' | 'full-width'")
        lines.insert(i + 2, "  onToggleLayout: () => void")
        break

for i, line in enumerate(lines):
    if "  onUndo," in line:
        lines.insert(i + 2, "  timelineLayout,")
        lines.insert(i + 3, "  onToggleLayout")
        break

icon_svg = """        {/* Layout Toggle */}
        <ToolBtn
          label="Toggle Layout"
          title={timelineLayout === 'full-width' ? 'Switch to Docked Layout' : 'Switch to Full-Width Layout'}
          onClick={onToggleLayout}
        >
          {timelineLayout === 'full-width' ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 14h16M9 4v10M15 4v10" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 14h16M14 4v10" />
            </svg>
          )}
        </ToolBtn>

        {/* Divider */}
        <span className="mx-1 h-5 w-px bg-line" />"""

for i, line in enumerate(lines):
    if '{/* Save shortcut button */}' in line:
        lines.insert(i, icon_svg)
        break

with open('src/renderer/routes/editor/EditorToolbar.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("EditorToolbar.tsx patched successfully.")
