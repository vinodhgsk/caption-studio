import sys

with open('src/renderer/routes/Editor.tsx', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

for i, line in enumerate(lines):
    if "import { useProjectStore } from '@/store/projectStore'" in line:
        lines.insert(i + 1, "import { useEditorStore } from '@/store/editorStore'")
        break

start_idx = -1
for i, line in enumerate(lines):
    if 'const saveStatus = useProjectStore((s) => s.saveStatus)' in line:
        lines.insert(i + 1, "  const timelineLayout = useEditorStore((s) => s.timelineLayout)")
        break

jsx_start = -1
for i, line in enumerate(lines):
    if '<div className="flex flex-1 overflow-hidden">' in line:
        jsx_start = i
        break

jsx_end = -1
for i in range(len(lines)-1, -1, -1):
    if '</main>' in lines[i]:
        jsx_end = i
        break

if jsx_start != -1 and jsx_end != -1:
    new_jsx = """      {timelineLayout === 'full-width' ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <LeftRail />
            <div className="flex flex-1 relative overflow-hidden">
              <PreviewRegion aspect={previewAspect} />
            </div>
            <PanelContainer />
          </div>
          {/* Vertical drag handle */}
          <div
            role="separator"
            aria-label="Resize timeline"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative z-20 flex h-2 w-full cursor-row-resize items-center justify-center bg-transparent shrink-0 group -my-1"
          >
            <div className="h-px w-full bg-line group-hover:bg-accent/70 group-active:bg-accent transition-colors" />
          </div>
          <TimelineRegion height={timelineHeight} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <LeftRail />
          <div className="flex flex-1 flex-col overflow-hidden relative">
            <PreviewRegion aspect={previewAspect} />
            {/* Vertical drag handle */}
            <div
              role="separator"
              aria-label="Resize timeline"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="relative z-20 flex h-2 w-full cursor-row-resize items-center justify-center bg-transparent shrink-0 group -my-1"
            >
              <div className="h-px w-full bg-line group-hover:bg-accent/70 group-active:bg-accent transition-colors" />
            </div>
            <TimelineRegion height={timelineHeight} />
          </div>
          <PanelContainer />
        </div>
      )}"""
    
    del lines[jsx_start:jsx_end]
    lines.insert(jsx_start, new_jsx)

with open('src/renderer/routes/Editor.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("Editor.tsx layout patched successfully.")
