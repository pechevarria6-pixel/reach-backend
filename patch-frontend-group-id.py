#!/usr/bin/env python3
"""Frontend fixes for reach-app.jsx:
1. inferGroupEmoji helper — picks an emoji from the group name
2. create() uses inferred emoji unless the user picked one manually
3. saveGroupToServer swaps the g_local_ temp id for the server's real id
   and removes the temp group if the POST failed
Run from repo root:  python3 patch-frontend-group-id.py
"""
import pathlib, re, sys

p = pathlib.Path("components/reach-app.jsx")
if not p.exists():
    sys.exit("ERROR: components/reach-app.jsx not found. Run from repo root.")

src = p.read_text()
changes = []

# 1. Module-level emoji helper, inserted right before CreateGroupScreen
helper = (
    'const DEFAULT_GROUP_EMOJI="\U0001F389";\n'
    'function inferGroupEmoji(n){const s=(n||"").toLowerCase();'
    'const rules=[[/birthday|bday/,"\U0001F382"],'
    '[/ski|snow|tahoe|aspen/,"\U0001F3BF"],'
    '[/beach|cabo|cancun|island|bahamas|miami|playa|lake/,"\U0001F3DD\uFE0F"],'
    '[/concert|show|festival|music|tour/,"\U0001F3B8"],'
    '[/dinner|food|restaurant|brunch|taco|pizza|omakase/,"\U0001F355"],'
    '[/camp|hike|hiking|trail|mountain|yosemite|zion/,"\U0001F3D5\uFE0F"],'
    '[/vegas|party|bachelor|bachelorette/,"\U0001F389"],'
    '[/golf/,"\u26F3"],[/wedding/,"\U0001F48D"],'
    '[/road ?trip|drive/,"\U0001F697"],'
    '[/europe|paris|tokyo|london|flight|abroad|trip|travel/,"\u2708\uFE0F"]];'
    'for(const r of rules){if(r[0].test(s))return r[1];}return DEFAULT_GROUP_EMOJI;}\n'
)
if "inferGroupEmoji" in src:
    changes.append("SKIP helper (already present)")
elif "function CreateGroupScreen(" in src:
    src = src.replace("function CreateGroupScreen(", helper + "function CreateGroupScreen(", 1)
    changes.append("OK   helper inferGroupEmoji")
else:
    changes.append("SKIP helper (CreateGroupScreen not found)")

# 2. Auto emoji inside create()
old2 = "const newGroup={id:tempId,name,emoji,"
new2 = ("const finalEmoji=(emoji&&emoji!==DEFAULT_GROUP_EMOJI)?emoji:inferGroupEmoji(name);"
        "const newGroup={id:tempId,name,emoji:finalEmoji,")
if old2 in src:
    src = src.replace(old2, new2, 1)
    changes.append("OK   auto emoji in create()")
else:
    changes.append("SKIP auto emoji (pattern not found)")

# 3. Swap temp id for real id after the POST in saveGroupToServer
pat = re.compile(
    r'(body:JSON\.stringify\(\{name:group\.name,emoji:group\.emoji,'
    r'memberIds:group\.memberIds\|\|\[\]\}\)\s*\}\);)'
)
swap = (
    '\n      try{const _d=await res.clone().json().catch(()=>null);'
    'const _realId=_d&&_d.group&&_d.group.id;'
    'if(res.ok&&_realId){setGroups(gs=>gs.map(g=>g.id===group.id?{...g,id:_realId}:g));}'
    'else if(!res.ok){setGroups(gs=>gs.filter(g=>g.id!==group.id));}'
    '}catch(_e){}'
)
src2, n = pat.subn(lambda m: m.group(1) + swap, src, count=1)
if n:
    src = src2
    changes.append("OK   id swap + temp-group eviction in saveGroupToServer")
else:
    changes.append("SKIP id swap (fetch pattern not found)")

print("\n".join(changes))
if any(c.startswith("OK") for c in changes):
    p.write_text(src)
    print("\nFile updated.")
else:
    print("\nNo changes made.")
