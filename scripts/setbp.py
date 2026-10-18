# Insert/replace a blueprint (and optional field overrides) inside one roster entry.
# usage: python3 scripts/setbp.py <id> '<bp ts literal>' [field=value ...]
import re, sys
p = 'src/sim/roster.ts'
s = open(p).read()
bid, bp = sys.argv[1], sys.argv[2]
start = s.index(f"    id: '{bid}',")
end = s.index("\n  },", start)
block = s[start:end]
block = re.sub(r"\n    bp: \{.*?\n    \},", "", block, flags=re.S)
lines = block.split('\n')
for i, l in enumerate(lines):
    if l.startswith('    L: '):
        lines.insert(i + 1, f"    bp: {bp},")
        break
block = '\n'.join(lines)
for kv in sys.argv[3:]:
    k, v = kv.split('=', 1)
    if re.search(rf"\b{k}: [^,]+(?:\([^)]*\))?", block) and k not in ('weapon',):
        block = re.sub(rf"\b{k}: ('[^']*'|[^,\n]+)", f"{k}: {v}", block, count=1)
    else:
        block = block.replace("    wheels:", f"    {k}: {v}, wheels:", 1)
s = s[:start] + block + s[end:]
open(p, 'w').write(s)
print('ok', bid)
