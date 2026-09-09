#!/usr/bin/env python3
"""Fix POST /api/groups 500: JIT user insert missing NOT NULL email.
Run from the repo root:  python3 patch-groups-jit-email.py
"""
import re, sys, pathlib

p = pathlib.Path("app/api/groups/route.ts")
if not p.exists():
    sys.exit("ERROR: app/api/groups/route.ts not found. Run from repo root.")

src = p.read_text()
orig = src
changes = []

def sub(pattern, repl, label, count=1):
    global src
    new, n = re.subn(pattern, repl, src, count=count)
    if n:
        src = new
        changes.append(f"OK   {label}")
    else:
        changes.append(f"SKIP {label}  (pattern not found)")

# 1. Import currentUser from Clerk
sub(r"import\s*\{\s*auth\s*\}\s*from\s*'@clerk/nextjs/server'",
    "import { auth, currentUser } from '@clerk/nextjs/server'",
    "import currentUser")

# 2. Fetch email/name from Clerk inside the JIT branch
sub(r"if\s*\(\s*!user\s*\)\s*\{",
    "if (!user) {\n"
    "    const cu = await currentUser();\n"
    "    const email = cu?.primaryEmailAddress?.emailAddress\n"
    "      ?? cu?.emailAddresses?.[0]?.emailAddress\n"
    "      ?? `${clerkId}@no-email.reach`;\n"
    "    const name = [cu?.firstName, cu?.lastName].filter(Boolean).join(' ') || null;",
    "derive email/name from Clerk")

# 3. Include email + name in the insert
sub(r"\.insert\(\s*\{\s*clerk_id:\s*clerkId\s*\}\s*\)",
    ".insert({ clerk_id: clerkId, email, name })",
    "insert email+name")

# 4. Capture the insert error
sub(r"const\s*\{\s*data:\s*created\s*\}\s*=",
    "const { data: created, error: userErr } =",
    "capture userErr")

# 5. Log + return on user insert failure
sub(r"if\s*\(\s*!created\s*\)\s*return\s*NextResponse\.json\(\s*\{\s*error:\s*\"Couldn't set up your profile\"\s*\}\s*,\s*\{\s*status:\s*500\s*\}\s*\);",
    "if (userErr || !created) {\n"
    "      console.error('[groups POST] user insert failed', userErr);\n"
    "      return NextResponse.json({ error: \"Couldn't set up your profile\" }, { status: 500 });\n"
    "    }",
    "log user insert failure")

# 6. Log group insert failure
sub(r"if\s*\(\s*error\s*\|\|\s*!group\s*\)\s*return\s*NextResponse\.json\(\s*\{\s*error:\s*'Failed to create group'\s*\}\s*,\s*\{\s*status:\s*500\s*\}\s*\);",
    "if (error || !group) {\n"
    "    console.error('[groups POST] group insert failed', error);\n"
    "    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });\n"
    "  }",
    "log group insert failure")

# 7. emoji optional in Zod schema
sub(r"emoji:\s*z\.string\(\)\.max\(10\),",
    "emoji: z.string().max(10).optional(),",
    "emoji optional")

print("\n".join(changes))
if src != orig:
    p.write_text(src)
    print("\nFile updated. Review with: git diff app/api/groups/route.ts")
else:
    print("\nNo changes made.")
