"use client";
// ─── "When did you last see this group in person?" ──────────────────────
// Business-model §4G M3. One screen, one tap, skippable: shown once to each
// person in a group — when they join it, and to the organiser when they
// create it. GET /api/groups/[id]/reconnection says whether this person has
// already answered (or skipped); when it says not to ask, this renders
// nothing and calls onDone straight away, so a caller can mount it
// unconditionally.
//
// Never in a group of one: there is nobody to have seen. The caller passes
// `solo`, because a group that was just created has one member until its
// invitations are accepted, and the server cannot tell those apart.
//
// Never a reason somebody cannot get into their group: a failed save is
// logged and the screen still gets out of the way.
import { useEffect, useRef, useState } from "react";
import { C } from "./tokens";
import { RECONNECTION_ANSWERS, RECONNECTION_SKIPPED, isTempId } from "./rules";

export default function ReconnectionQuestion({ groupId, groupName, solo = false, onDone }) {
  const [ask, setAsk] = useState(false);
  const [sending, setSending] = useState(null);
  const first = useRef(null);
  const [closed, setClosed] = useState(false);
  const finished = useRef(false);
  const finish = () => { if (finished.current) return; finished.current = true; setClosed(true); if (onDone) onDone(); };

  useEffect(() => {
    if (solo || !groupId || isTempId(groupId)) { finish(); return; }
    let off = false;
    fetch(`/api/groups/${groupId}/reconnection`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (off) return; if (d?.ask) setAsk(true); else finish(); })
      .catch(e => { console.error("[reconnection] could not check whether to ask", { groupId }, e); if (!off) finish(); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, solo]);

  useEffect(() => { if (ask && first.current) first.current.focus(); }, [ask]);

  const answer = async (id) => {
    if (sending) return;
    setSending(id);
    try {
      const r = await fetch(`/api/groups/${groupId}/reconnection`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: id }),
      });
      if (!r.ok) console.error("[reconnection] answer not saved", { groupId, status: r.status });
    } catch (e) {
      console.error("[reconnection] answer not saved", { groupId }, e);
    }
    finish();
  };

  useEffect(() => {
    if (!ask) return;
    const onKey = (e) => { if (e.key === "Escape") answer(RECONNECTION_SKIPPED); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  if (!ask || closed) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="reconnect-q"
      style={{ position: "fixed", inset: 0, zIndex: 400, background: C.bg, display: "flex", flexDirection: "column",
        justifyContent: "center", padding: "24px 16px", overflowY: "auto" }}>
      <div style={{ maxWidth: 440, width: "100%", margin: "0 auto" }}>
        {groupName && <div style={{ fontSize: 13, color: C.t3, marginBottom: 6 }}>{groupName}</div>}
        <h2 id="reconnect-q" style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 26, lineHeight: 1.2, color: C.t1, margin: "0 0 20px" }}>
          When did you last see this group in person?
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {RECONNECTION_ANSWERS.map((a, i) => (
            <button key={a.id} ref={i === 0 ? first : undefined} type="button" disabled={!!sending} onClick={() => answer(a.id)}
              style={{ minHeight: 52, padding: "12px 16px", borderRadius: 16, textAlign: "left", fontSize: 16, fontFamily: "var(--font-body)",
                border: `1px solid ${sending === a.id ? C.accentText : C.border}`, background: sending === a.id ? C.accentDim : C.s2,
                color: C.t1, cursor: sending ? "progress" : "pointer" }}>
              {a.label}
            </button>
          ))}
        </div>
        <button type="button" disabled={!!sending} onClick={() => answer(RECONNECTION_SKIPPED)}
          style={{ display: "block", margin: "18px auto 0", minHeight: 44, padding: "10px 20px", background: "none", border: "none",
            color: C.t2, fontSize: 14, fontFamily: "var(--font-body)", cursor: "pointer", textDecoration: "underline" }}>
          Skip
        </button>
      </div>
    </div>
  );
}
