import sys

with open('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

# We'll identify the blocks by finding their start and end strings, then we'll remove them.
def remove_block(start_str, end_str):
    global lines
    start_idx = -1
    for i, line in enumerate(lines):
        if start_str in line:
            start_idx = i
            break
    if start_idx == -1:
        return
    end_idx = -1
    for i in range(start_idx, len(lines)):
        if end_str in lines[i]:
            end_idx = i
            break
    if end_idx != -1:
        del lines[start_idx:end_idx+1]

# 1. Add import
for i, line in enumerate(lines):
    if "import { CAPTION_TRACK_ID } from '@/store/timeline'" in line:
        lines.insert(i + 1, "import { CaptionStyleSection } from './CaptionStyleSection'")
        break

# 1b. Remove unused import functions
for i, line in enumerate(lines):
    if 'setCaptionLineHeightAction' in line or 'setCaptionLetterSpacingAction' in line or 'wrapCaptionTextAction' in line:
        lines[i] = ""

# 2. Remove states
remove_block("const [captionFontSize, setCaptionFontSize] = useState(144)", "const [shadowDistance, setShadowDistance] = useState(4)")

# 3. Remove useEffect
remove_block("useEffect(() => {", "  }, [captionClips])")

# 4. Remove fontOptions
remove_block("const fontOptions = useMemo(() => {", "  }, [])")

# 5. Remove applyCaptionRefinements
remove_block("const applyCaptionRefinements = (): void => {", "  }")
# Also remove its call:
lines = [l for l in lines if 'applyCaptionRefinements()' not in l]

# 6. Replace Section "Caption style"
start_sec = -1
for i, line in enumerate(lines):
    if '<Section title="Caption style">' in line:
        start_sec = i - 1  # includes the comment before it
        break

if start_sec != -1:
    depth = 0
    end_sec = -1
    for i in range(start_sec, len(lines)):
        if '<Section' in lines[i]:
            depth += 1
        if '</Section>' in lines[i]:
            depth -= 1
            if depth == 0:
                end_sec = i
                break
    if end_sec != -1:
        lines[start_sec:end_sec+1] = ["      <CaptionStyleSection disabled={running} />"]

with open('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print("AutoCaptionPanel patched correctly.")
