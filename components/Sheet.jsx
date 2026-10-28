"use client";
// ─── One bottom sheet, used by every action sheet ────────────────────────
// Nine sheets were each hand-built: two classes, three inline copies with
// their own overlay, and no two closed the same way. None trapped focus, so
// a keyboard user tabbed out from under the sheet into the screen behind it;
// none answered Escape; and on a phone the only way out was finding "Done"
// or tapping the dim strip above — the grab handle at the top was drawn and
// did nothing.
//
// This one:
//   - slides up in 200ms (the `su` keyframe on .sh), and not at all for
//     somebody who asked their system for less motion;
//   - drags down to dismiss from the handle, and springs back if let go
//     early;
//   - keeps Tab inside it, and gives focus back to whatever opened it;
//   - closes on Escape — the top sheet only, when one opens another.
//
// `dismissable={false}` is for a sheet that must be answered: no handle, no
// tap-outside, no Escape.
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/feel";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Open sheets, innermost last. Escape and Tab belong to the top one.
const OPEN = [];

/** How far down a drag must travel, or how fast, before the sheet goes. */
const DISMISS_PX = 90;
const FLICK_PX_PER_MS = 0.6;

export default function Sheet({ onClose, label, children, style, fixed = false, dismissable = true, className = "" }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    const me = {};
    OPEN.push(me);
    const before = typeof document !== "undefined" ? document.activeElement : null;
    const el = panel.current;
    const first = el?.querySelector(FOCUSABLE);
    try { (first || el)?.focus({ preventScroll: true }); } catch (e) { console.warn("[sheet] could not move focus in", e); }
    const onKey = e => {
      if (OPEN[OPEN.length - 1] !== me || !el) return;
      if (e.key === "Escape") {
        if (!dismissable) return;
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const all = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.getClientRects().length > 0);
      if (!all.length) { e.preventDefault(); el.focus(); return; }
      const a = all[0], z = all[all.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === a || at === el || !el.contains(at))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (at === z || !el.contains(at))) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = OPEN.indexOf(me);
      if (i >= 0) OPEN.splice(i, 1);
      try { before?.focus?.({ preventScroll: true }); } catch (e) { console.warn("[sheet] could not give focus back", e); }
    };
  }, []);

  const down = e => {
    if (!dismissable) return;
    drag.current = { y: e.clientY, t: Date.now() };
    setDragging(true);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (err) { console.warn("[sheet] pointer not captured", err); }
  };
  const move = e => {
    if (!drag.current) return;
    setDy(Math.max(0, e.clientY - drag.current.y));
  };
  const up = e => {
    if (!drag.current) return;
    const moved = Math.max(0, e.clientY - drag.current.y);
    const speed = moved / Math.max(1, Date.now() - drag.current.t);
    drag.current = null;
    setDragging(false);
    if (moved > DISMISS_PX || (moved > 30 && speed > FLICK_PX_PER_MS)) { closeRef.current?.(); return; }
    setDy(0);
  };

  const still = prefersReducedMotion();
  return (
    <div className="ov" style={fixed ? { position: "fixed", zIndex: 60 } : undefined}
      onClick={() => { if (dismissable) closeRef.current?.(); }}>
      <div ref={panel} className={`sh ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{
          ...style,
          ...(dy ? { transform: `translateY(${dy}px)` } : {}),
          transition: dragging || still ? "none" : "transform .2s cubic-bezier(.32,.72,0,1)",
        }}>
        {dismissable && (
          <div className="sh-drag" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            aria-hidden="true">
            <div className="sh-hdl" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
