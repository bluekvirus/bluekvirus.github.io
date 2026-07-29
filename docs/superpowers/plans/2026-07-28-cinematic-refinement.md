# Cinematic Refinement Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all cyber-neon styling (diegetic light only) and rebuild the sandworm as a continuous film-style Shai-Hulud, per the v3 spec.

**Architecture:** No structural changes — same modules, contracts, budgets, fallback ladder as v2. This is a styling + one-model rebuild pass.

**Tech Stack:** unchanged (three.js 0.170.0 CDN, bare `node --test`, http.server + Playwright).

**Spec:** `docs/superpowers/specs/2026-07-28-cinematic-refinement-design.md` (normative), on top of the v2 spec.

## Global Constraints

Carried from v2 verbatim: no build step; colors only in `palette.js`, coordinates only in `layout.js`; zero per-frame allocations; dt>0 gating; updater contract; perf ≤60 calls / ≤150k tris; bare `node --test` (12 expected throughout); browser checks on the ALREADY-RUNNING :8080 server (never start/kill it; CDP `Network.clearBrowserCache` before goto; `emulateMedia({reducedMotion:'no-preference'})` for animation judgment); commits end with the branch's Co-Authored-By trailer.

New for v3: **zero cyan/magenta pixels**; **no emissive on the worm**; worm ≤25k tris, ≤4 draw calls.

---

### Task 1: De-neon pass — palette v3, spice, troops, tracers, HUD, bloom

**Files:** Modify `themes/dune/palette.js`, `themes/dune/props.js`, `themes/dune/troops.js`, `themes/dune/combatfx.js`, `themes/dune/main.js` (bloom knobs only), `css/main.css`, `tests/palette.test.mjs`.

**Exact palette delta:** remove `neonCyan, neonMagenta, tracerCyan, fremenEyes`; add `tracerFremen 0xffd9a0, wormHideDark 0x3a2e28, wormHideLit 0x6b5344, wormMaw 0x1a0f0d, wormTeeth 0xcbb89a`. (Old `wormHide` may be removed once Task 2 no longer uses it — if Task 1 runs first, keep `wormHide` until Task 2 then remove there; the palette test asserts the four removals + five additions only.)

**Changes:** spice all-amber (drop cyan fraction; warm variation ok); Fremen emissive accent removed (non-emissive dark patch ok), Harkonnen visor dimmed to faint equipment light; Fremen tracers → `tracerFremen`, Harkonnen stay `harkRed`; HUD CSS re-styled sand/ember per spec (name amber + soft warm shadow, links pale sand `#e8d5b5` → amber hover, no colored neon glows; fallback links match); bloom knobs toward strength ~0.5 / threshold ~0.85 (tunable).

- [ ] **Step 1:** Update `tests/palette.test.mjs` (removals + additions), run bare `node --test` → fails; implement palette v3 → 12 pass.
- [ ] **Step 2:** Implement module + CSS changes.
- [ ] **Step 3:** Visual iteration (≤5 rounds) on `?theme=dune&debug`. **Criteria:** (a) NO cyan/magenta pixels anywhere (inspect screenshots incl. spice, tracers, troops); (b) only flashes/explosions/engine glow/running lights halo; (c) tracer firefight still legible (pale-gold vs red, direction/origin); (d) HUD reads warm/cinematic against the scene; (e) scene overall unchanged in composition. Worm still has old cyan rings until Task 2 — EXCLUDE the worm from criterion (a), note it.
- [ ] **Step 4:** Perf via debug direct render (≤60/≤150k), record. Commit `style: remove neon styling - diegetic light only`.

---

### Task 2: Film-style Shai-Hulud

**Files:** Rewrite rendering in `themes/dune/worm.js` (keep path/cycle/wake/spray logic; remove ring InstancedMesh + cyan entirely; remove `wormHide` from `palette.js` if unused after this).

**Contract unchanged:** `createWorm() → { group, update(dt, elapsed) }`.

**Build requirements (design the geometry yourself — iterate visually):**
- Body: ~40 overlapping tapered ring-plate segments (low-poly conical frustums, 10-14 sides, raised leading lip), overlap ≥40% of segment length → continuous plated tube, never beads. Radius profile: broad head (~34-40) holding through fore-body, tapering over last third to blunt tail. ONE InstancedMesh, flat-shaded standard material, two-tone hide via per-instance colors or baked vertex colors (`wormHideDark`→`wormHideLit`, dusty top / dark underside).
- Maw: dark interior cone (`wormMaw`) + 2 concentric instanced teeth rings (~48 thin cones total, `wormTeeth`), attached to the head segment's frame. Gape animation: teeth rings + outer lip flare open around the breach apex (drive from the existing cycle phase — reuse the head-lift/`above` logic), closed while submerged/cruising.
- Subtle per-segment lateral undulation (phase-offset sine) so the arc feels alive.
- NO emissive components. Keep dust wake + spray (amber/dustTan).
- Budget: ≤4 draw calls (body, teeth, maw, particles), ≤25k tris. Zero per-frame allocations (matrix scratch reuse as before); dt>0 gating carries over.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Visual iteration (≤5 rounds), sampling the full 55s cycle (freeze/step the clock via debug handle for inspection, confirm at real pacing after). **Criteria:** (a) body reads as ONE continuous plated creature at every sampled cycle point — zero gaps/beads; (b) breach silhouettes the gaping tooth-ringed maw against the sky, unmistakably Shai-Hulud; (c) hide reads rocky/earthen, not smooth plastic — lip ridges visible; (d) no glow anywhere on the worm; (e) still doesn't collide visually with the harvester more than the accepted overlap window. Knobs: segment count/profile/overlap, lip geometry, maw/teeth proportions, gape timing/extent, undulation amplitude.
- [ ] **Step 3:** Bare `node --test` (12; update palette test if `wormHide` removed), perf recorded (worm ≤25k tris within scene budgets). Commit `feat: film-style shai-hulud with plated body and gaping maw`.

---

### Task 3: Responsive screen support

**Files:** Modify `themes/dune/main.js` (responsive camera framing), `css/main.css` (HUD breakpoints), `themes/dune/layout.js` only if a portrait cam target constant is needed.

**Requirement (user):** the page must present well across screen shapes — desktop wide, laptop, tablet, and phone portrait/landscape — not merely survive resize.

**Build requirements:**
- **Aspect-aware framing:** at wide aspect (≥ ~1.4) keep the current framing. As aspect narrows toward portrait, the fixed fov 58 + camTarget crops the battle badly — compensate responsively in `onResize` (and initial mount): widen fov (up to ~72) and/or pull the camera back along its look direction as a smooth function of aspect so the harvester + firefight + worm horizon all remain in frame at 390×844 portrait. Deterministic pure function of aspect (e.g., lerp between two calibrated setups); no per-frame work beyond what exists.
- **Orientation change:** rotating a phone (resize event with swapped dimensions) must re-frame correctly without reload; `state.small` (pixel ratio / bloom-res / particle counts) is set once at mount — that's acceptable (document it), but framing must be live-responsive.
- **HUD breakpoints:** current single ≤600px query is crude. Ensure: no overlap of name/nav/copyright at 320px-wide portrait; nav wraps cleanly with tap-friendly spacing (≥44px touch targets — resolves a parked v1 note); copyright may drop to a second line or hide at very narrow widths; name scales down.
- **Fallback page** remains readable at all widths (it's simple flow content — verify, fix only if broken).

- [ ] **Step 1:** Implement aspect-aware framing + HUD breakpoints.
- [ ] **Step 2:** Visual iteration (≤5 rounds) at these viewports: 1920×1080, 1280×800, 1024×768, 768×1024, 390×844, 320×568 (Playwright browser_resize). **Criteria per viewport:** (a) harvester + battle zone + worm horizon in frame; (b) HUD legible, nothing overlapping, nav tappable on touch sizes; (c) no distortion/stretching artifacts; (d) landscape↔portrait resize re-frames live without reload.
- [ ] **Step 3:** Bare `node --test` (12); commit `feat: responsive framing and HUD across screen shapes`.

---

### Task 4: Whole-scene QA + README

**Files:** Modify `README.md`; tuning knobs from any module if the composed judgment demands.

- [ ] **Step 1:** Whole-scene judgment at 3+ cycle moments (cruise, breach apex w/ maw, explosion mid-burst): v3 acceptance 1-5 (zero cyan/magenta; only diegetic halos; continuous worm; gaping maw at breach; warm HUD) plus v2's 7 criteria still holding. Tune minimally as needed.
- [ ] **Step 2:** Full sweep: bare `node --test` (12); `/`, `/?theme=zzz`, `/?nogl=1`, resize, 390×844 AND 320×568 portrait (responsive framing holds), reduced-motion (still frame, no new FX), forceDegrade stages 1-2 render clean; perf via direct render recorded.
- [ ] **Step 3:** README: adjust styling description (cinematic dusk, no neon), worm description (film-style Shai-Hulud), note responsive framing. Commit `chore: cinematic refinement QA and README`.

---

## Plan Self-Review Notes

- Spec coverage: palette/spice/troops/tracers/HUD/bloom de-neon (T1), worm rebuild incl. maw/gape/undulation/no-emissive (T2), acceptance sweep + README (T3). `wormHide` removal handled with an explicit T1/T2 handoff note.
- Task 1 excludes the worm from the no-cyan criterion (old rings persist until T2) — ordering conflict resolved explicitly.
- Contracts untouched; no interface drift possible between tasks.
