#!/usr/bin/env python3
"""Fix /api/trips/generate itinerary 500: truncated LLM JSON.
Run from repo root:  python3 patch-trips-itinerary.py
"""
import pathlib, sys

p = pathlib.Path("app/api/trips/generate/route.ts")
if not p.exists():
    sys.exit("ERROR: app/api/trips/generate/route.ts not found. Run from repo root.")

src = p.read_text()
changes = []

# 1. Raise itinerary max_tokens (first bare occurrence = itinerary call at ~line 76;
#    the Stage-1 one at ~139 has a trailing comment and stays at 3000)
if "max_tokens: 3000," in src:
    src = src.replace("max_tokens: 3000,", "max_tokens: 8000,", 1)
    changes.append("OK   max_tokens 3000 -> 8000 (itinerary call)")
else:
    changes.append("SKIP max_tokens bump (pattern not found)")

# 2. Guard the itinerary JSON.parse
old = "const itinerary = JSON.parse(text);"
new = (
    "let itinerary;\n"
    "  try {\n"
    "    itinerary = JSON.parse(text);\n"
    "  } catch (e) {\n"
    "    console.error('[trips itinerary] JSON parse failed, len', text.length, 'tail:', text.slice(-300));\n"
    "    return NextResponse.json({ error: 'AI response parsing failed - please try again' }, { status: 500 });\n"
    "  }"
)
if old in src:
    src = src.replace(old, new, 1)
    changes.append("OK   guarded itinerary JSON.parse")
else:
    changes.append("SKIP itinerary parse guard (pattern not found)")

print("\n".join(changes))
if any(c.startswith("OK") for c in changes):
    p.write_text(src)
    print("\nFile updated.")
else:
    print("\nNo changes made.")
