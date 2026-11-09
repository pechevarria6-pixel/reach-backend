"use client";
// ─── The organiser's few questions after a trip ─────────────────────────
// REACH-PILOT-GATE-2026-11-08.md A7 / business-model §4G M2. Shown on the
// plan's overview, under "How was it?", to the organiser only, once, after a
// trip that happened — GET /api/plans/[id]/debrief decides all of that, and
// this renders nothing unless it says ask.
//
// Three taps finish it: roughly how long, a 0–10 score, and "Would you run
// the next one?", whose two answers send it. The message count and the note
// are there for whoever wants them and never block sending.
//
// The two last answers look alike on purpose. A bright "Yes" beside a quiet
// "No" is a leading question, and this one is a pre-registered readout.
import { useEffect, useState } from "react";
import { C, TAP } from "./tokens";
import { ALMOST_QUIT_MAX, HOURS_CHOICES, MESSAGE_CHOICES, NPS_SCORES, debriefReady, isTempId } from "./rules";

function Chip({ on, label, onClick, disabled, wide }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onClick}
      style={{
        minHeight: TAP, minWidth: TAP, padding: wide ? "10px 14px" : "10px 0",
        borderRadius: 14, fontSize: 14, fontWeight: on ? 700 : 500, cursor: disabled ? "progress" : "pointer",
        border: `1px solid ${on ? C.accentText : C.border}`, background: on ? C.accentDim : C.s2,
        color: on ? C.accentText : C.t1, fontFamily: "var(--font-body)",
      }}>
      {label}
    </button>
  );
}

function Question({ id, title, hint, children }) {
  return (
    <div style={{ marginTop: 16 }} role="radiogroup" aria-labelledby={id}>
      <div id={id} style={{ fontSize: 15, fontWeight: 600, color: C.t1, marginBottom: hint ? 2 : 8 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: C.t3, marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

export default function DebriefForm({ planId, toast }) {
  const [state, setState] = useState(null);
  const [hours, setHours] = useState(null);
  const [messages, setMessages] = useState(null);
  const [nps, setNps] = useState(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!planId || isTempId(planId)) return;
    let off = false;
    fetch(`/api/plans/${planId}/debrief`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!off) setState(d); })
      .catch(e => console.error("[debrief] could not check whether to ask", { planId }, e));
    return () => { off = true; };
  }, [planId]);

  if (done) {
    return (
      <div style={{ margin: "0 20px 16px", padding: 16, background: C.s1, border: `1px solid ${C.border}`, borderRadius: 18 }}>
        <div style={{ fontSize: 14, color: C.t1 }}>Thank you — that's saved.</div>
        {done.noteSaved === false && (
          <div style={{ fontSize: 12.5, color: C.t3, marginTop: 6 }}>Your note couldn't be kept this time; the rest was.</div>
        )}
      </div>
    );
  }
  if (!state?.ask) return null;

  const ready = debriefReady({ hours, nps });
  const send = async (wouldRunAgain) => {
    if (!ready || sending !== null || isTempId(planId)) return;
    setSending(wouldRunAgain);
    try {
      const r = await fetch(`/api/plans/${planId}/debrief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hours, nps, would_run_again: wouldRunAgain,
          ...(messages ? { messages } : {}),
          ...(note.trim() ? { almost_quit: note.trim() } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      // Already answered (another phone, a double tap) is answered.
      if (r.status === 409 && d.why === "submitted") { setDone({ noteSaved: true }); return; }
      if (!r.ok) throw new Error(d.error || "Couldn't save that — try again");
      setDone({ noteSaved: d.noteSaved !== false });
    } catch (e) {
      console.error("[debrief] not saved", { planId }, e);
      if (toast) toast(e.message);
    } finally {
      setSending(null);
    }
  };

  const busy = sending !== null;
  return (
    <section aria-label="You organised this one" style={{ margin: "0 20px 16px", padding: 16, background: C.s1, border: `1px solid ${C.border}`, borderRadius: 18 }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: C.t1 }}>You organised this one</div>
      <div style={{ fontSize: 13, color: C.t2, marginTop: 4, lineHeight: 1.45 }}>Three taps. It tells us what this trip took out of you.</div>

      <Question id={`db-hours-${planId}`} title="Roughly how long did organising take?">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8 }}>
          {HOURS_CHOICES.map(c => (
            <Chip key={c.id} wide on={hours === c.id} label={c.label} disabled={busy} onClick={() => setHours(c.id)} />
          ))}
        </div>
      </Question>

      <Question id={`db-msgs-${planId}`} title="Roughly how many messages did you send about it?" hint="Optional — a guess is fine.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8 }}>
          {MESSAGE_CHOICES.map(c => (
            <Chip key={c.id} wide on={messages === c.id} label={c.label} disabled={busy}
              onClick={() => setMessages(m => (m === c.id ? null : c.id))} />
          ))}
        </div>
      </Question>

      <Question id={`db-nps-${planId}`} title="How likely are you to recommend Reach to a friend?" hint="0 is not at all, 10 is definitely.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6 }}>
          {NPS_SCORES.map(n => (
            <Chip key={n} on={nps === n} label={String(n)} disabled={busy} onClick={() => setNps(n)} />
          ))}
        </div>
      </Question>

      <div style={{ marginTop: 16 }}>
        <label htmlFor={`db-note-${planId}`} style={{ fontSize: 15, fontWeight: 600, color: C.t1, display: "block" }}>What almost made you quit?</label>
        <div style={{ fontSize: 12.5, color: C.t3, margin: "2px 0 8px" }}>Optional. Only the Reach team reads this.</div>
        <textarea id={`db-note-${planId}`} value={note} maxLength={ALMOST_QUIT_MAX} rows={3} disabled={busy}
          onChange={e => setNote(e.target.value.slice(0, ALMOST_QUIT_MAX))}
          style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 14, border: `1px solid ${C.border}`,
            background: C.s2, color: C.t1, fontSize: 16, fontFamily: "var(--font-body)", resize: "vertical" }} />
        <div style={{ fontSize: 11.5, color: C.t3, textAlign: "right" }} aria-live="polite">{note.length}/{ALMOST_QUIT_MAX}</div>
      </div>

      <div style={{ marginTop: 12 }} role="group" aria-labelledby={`db-again-${planId}`}>
        <div id={`db-again-${planId}`} style={{ fontSize: 15, fontWeight: 600, color: C.t1, marginBottom: 8 }}>Would you run the next one?</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ v: true, label: "Yes, I would" }, { v: false, label: "Not me" }].map(o => (
            <button key={String(o.v)} type="button" disabled={!ready || busy} onClick={() => send(o.v)}
              style={{ flex: 1, minHeight: 52, borderRadius: 18, fontSize: 15, fontWeight: 600, fontFamily: "var(--font-body)",
                cursor: !ready ? "not-allowed" : busy ? "progress" : "pointer", opacity: ready ? 1 : 0.45,
                border: `1px solid ${C.accentBorder}`, background: C.s2, color: C.t1 }}>
              {sending === o.v ? "Saving…" : o.label}
            </button>
          ))}
        </div>
        {!ready && <div style={{ fontSize: 12, color: C.t3, marginTop: 6 }}>Pick the hours and a score first — this sends it.</div>}
      </div>
    </section>
  );
}
