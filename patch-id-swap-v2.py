#!/usr/bin/env python3
"""Retry: insert the temp-id -> real-id swap in saveGroupToServer.
Anchors on the body line, then inserts after the fetch call's closing '});'.
Run from repo root:  python3 patch-id-swap-v2.py
"""
import pathlib, sys

p = pathlib.Path("components/reach-app.jsx")
if not p.exists():
    sys.exit("ERROR: components/reach-app.jsx not found. Run from repo root.")

src = p.read_text()

if "res.clone()" in src:
    sys.exit("Already applied - nothing to do.")

anchor = "memberIds:group.memberIds||[]})"
i = src.find(anchor)
if i == -1:
    sys.exit("ERROR: body anchor not found - send me: grep -n 'JSON.stringify({name:group.name' components/reach-app.jsx")

j = src.find("});", i)
if j == -1:
    sys.exit("ERROR: fetch closing '});' not found after anchor.")

insert_at = j + len("});")
swap = (
    "\n      try{const _d=await res.clone().json().catch(()=>null);"
    "const _realId=_d&&_d.group&&_d.group.id;"
    "if(res.ok&&_realId){setGroups(gs=>gs.map(g=>g.id===group.id?{...g,id:_realId}:g));}"
    "else if(!res.ok){setGroups(gs=>gs.filter(g=>g.id!==group.id));}"
    "}catch(_e){}"
)
src = src[:insert_at] + swap + src[insert_at:]
p.write_text(src)
print("OK   id swap inserted after the /api/groups POST")
print("Verify with: grep -n 'res.clone' components/reach-app.jsx")
