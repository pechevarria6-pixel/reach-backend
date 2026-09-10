#!/usr/bin/env python3
"""Navigate to planDetail with the REAL plan id returned by savePlanToServer.
Three call sites; each becomes: save -> then(navigate with real id, temp as fallback).
Run from repo root:  python3 patch-plan-nav-id.py
"""
import pathlib, sys

p = pathlib.Path("components/reach-app.jsx")
if not p.exists():
    sys.exit("ERROR: components/reach-app.jsx not found. Run from repo root.")

src = p.read_text()
changes = []

def replace_once(label, old, new):
    global src
    n = src.count(old)
    if n == 1:
        src = src.replace(old, new)
        changes.append(f"OK   {label}")
    else:
        changes.append(f"SKIP {label} (found {n} matches, need exactly 1)")

# Site 1: ExpDetailScreen (~554/558)
replace_once("ExpDetail save",
    'if(savePlanToServer)savePlanToServer(group.id,np);',
    'const _sp1=savePlanToServer?savePlanToServer(group.id,np):Promise.resolve(null);')
replace_once("ExpDetail nav",
    'push("planDetail",{planId:np.id,groupId:group.id});',
    '_sp1.then(_rid=>push("planDetail",{planId:_rid||np.id,groupId:group.id}))'
    '.catch(()=>push("planDetail",{planId:np.id,groupId:group.id}));')

# Site 2: GroupTripScreen (~1568/1597)
replace_once("GroupTrip save",
    'if(savePlanToServer)savePlanToServer(groupId,np);',
    'const _sp2=savePlanToServer?savePlanToServer(groupId,np):Promise.resolve(null);')
replace_once("GroupTrip nav",
    'push("planDetail",{planId:np.id,groupId});',
    '_sp2.then(_rid=>push("planDetail",{planId:_rid||np.id,groupId}))'
    '.catch(()=>push("planDetail",{planId:np.id,groupId}));')

# Site 3: CreatePlanFlow (~2417/2057)
replace_once("CreatePlanFlow save",
    'if(typeof savePlanToServer==="function")savePlanToServer(gid,np);',
    'const _sp3=(typeof savePlanToServer==="function")?savePlanToServer(gid,np):Promise.resolve(null);')
replace_once("CreatePlanFlow nav",
    'push("planDetail",{planId:newPlan.id,groupId});',
    '_sp3.then(_rid=>push("planDetail",{planId:_rid||newPlan.id,groupId}))'
    '.catch(()=>push("planDetail",{planId:newPlan.id,groupId}));')

print("\n".join(changes))
if any(c.startswith("OK") for c in changes):
    p.write_text(src)
    print("\nFile updated. Pairs must both be OK: a lone save-OK without its nav-OK")
    print("(or vice versa) in the same site means send me the SKIP lines before pushing.")
else:
    print("\nNo changes made.")
