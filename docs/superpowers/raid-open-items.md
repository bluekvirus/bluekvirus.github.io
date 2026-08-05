# raid — open items

Carried out of phase D (both plans). Everything here is known, measured, and
deliberately not fixed in phase D. Nothing here is a build failure: the suite
is green and every mission resolves.

Ordered by what would hurt most if left alone.

---

## 1. A mission that never terminates

**Seed `RVX-11-133`, rooms 11.** Times out at `MISSION_LIMIT` 12,000. Raised
to 200,000 in a scratchpad copy, it still has not resolved, with
`_goalStrikes` ratcheting monotonically past 2,000.

Not a body-collision bug. In the extract phase the last living SWAT is pinned
at `x = 9.0023` bit-identically, oscillating in `z` between 7.11 and 7.47,
with the nearest living agent ~20 m away and no props within 3 m. Its
`pathIndex` has advanced past the corner waypoints that routed it round a
wall, and it now steers straight at the goal through the geometry the route
was shaped to avoid. That is the corner-cut mode the `arriveReach` comment at
`raid/sim/world.js` warns about for the body-relaxation case, happening here
on the plain `arriveRadius` path clip.

Rate is roughly **1 in 40,000 missions**. The hostage is already at the
extraction point in this one; only the wedged SWAT prevents success.

**Why nothing catches it.** It oscillates rather than freezes, so
`dryrun.test.js`'s still-run tracker scores it **25**. That is exactly the
class the tracker's own header names — "an agent that only oscillates must
score as badly as one standing perfectly still" — and that property is
covered synthetically but never end-to-end. "Mission always resolves" passes
because `MISSION_LIMIT` fires. `timeout` reachability is likewise only
covered synthetically, by spinning the clock.

**Consequence for `MISSION_LIMIT`.** It is not slack. It is the sole
terminator of a real hang class. Lowering it on the strength of a healthy-
mission margin would convert good missions into timeouts without touching the
hang.

**Fix shape:** either clip the path index against line-of-sight to the next
waypoint, or make the still-run tracker measure net displacement over a window
rather than per-tick stillness, so oscillators score as stalls. The second is
the one that would have caught this.

## 2. Extraction is 29.6%, down 16 points across phase D

At Plan A's close it was 45.9%. Fully accounted for, each step separately
reviewed, and no single review saw the sum:

| step | effect |
|---|---|
| fall-back rule deleted | **+6.2** paired, p≈1e-5 |
| melee survivability | −8.7 to −10.7 |
| ammunition and reload | −3.0 paired, **not significant** at n=400 |
| hard body collision | −8.4 paired |

This is a **design question, not a defect** — the standing decision is that
combat is fully lethal, missions may fail, and win rate is measured but never
gated by a test. It is listed here because 29.6% is a materially different
game from 45.9% and nobody has yet said whether that is the intended
difficulty. No constant was tuned toward a difficulty target because no brief
authorised one.

The cheapest lever if it should come back up is item 4 below.

## 3. Coverage and hostile encounter regressed

Map coverage 77.0% → 73.1%; hostile encounter 65.7% → 58.2%. Downstream of
squad mortality rather than search quality, and still far above the scripted
route phase D replaced. Noted because `dryrun`'s gate is a fixed 20-seed
aggregate and would not necessarily catch further slippage of this size.

## 4. A reloading agent stands still in the open

`raid/sim/world.js` halts a gun agent in place whenever it has a target in
range, with no reload awareness — so a reloading SWAT member is motionless for
~1.85 s under fire. This is the mechanism behind reload's measured extraction
cost and the obvious lever if item 2 should be reversed.

## 5. An interrupted reload restarts rather than resumes

`startClip` always begins at `g.from`, so a cross-fade back after a flinch
replays from frame 0. Measured: interrupted at frame 19.5, back at frame 2.5
after a 34-tick flinch. A restarted reload therefore reaches only ~frame 54
before the simulation's 108-tick window closes — it replays the strip and seat
and **never reaches the rack**. Cosmetic only; the simulation's timing is
unaffected.

A real fix means teaching `crossfade` a per-group resume frame, which touches
every clip.

## 6. A figure reloading while running has a static lower body

The hand-authored clip holds `Idle_Gun`'s frame-0 pose wherever it does not
author, for the full 1.8 s. Strictly better than legs frozen at whatever the
previous clip last wrote, and reload is usually stationary. The fix if it ever
reads badly is an overlay clip — `archive/rifle-wip`'s `createOverlayClip` is
exactly that machinery.

## 7. `setGoal` carries the recovery timers

It now resets none of the five. Latent sharp edge with **no measured cost**:
over 137,406 calls in 2,000 missions, 85 (0.06%) land while a yield is live
and 50 (0.04%) while a nudge is. Missions where the carry happens measure
*better*, not worse — which is more likely a selection effect than evidence of
safety, so treat the absence of cost as unproven rather than established.

## 8. One-tick reload window mismatch

The renderer's clip branch uses `reloadUntil > ticks` (exclusive) while the
simulation treats `tick === reloadUntil` as still reloading (inclusive). The
animation ends one tick before the reload does. Specified that way
deliberately; recorded so the next reader does not treat it as a bug.

## 9. Two uncovered lines

- The wall/body co-refusal change in `world.js`: `primaryBody` is `null`
  whenever a wall refused, so wall+body co-refusals no longer take the
  tangent. Matches the documented intent, but nothing reddens if it is
  reverted.
- Removing the contact-scoping from the last-resort tier is a *widening*, so
  no behavioural test can forbid it. What it breaks is inertness at
  `bodyRadius` 0, which is established by determinism measurement instead.

---

## Explicitly out of scope, and why

**Squad tactics** — stack, breach, and cover are described in the phase D
spec's scope list but were never built. Only slot-spread convergence and the
fall-back rule exist. The spec's own list has been corrected to say so.

**Finite spare magazines** — decided against in the spec. Reload costs time,
not ammunition.

---

## Method notes worth keeping

Three rounds of this plan were spent on the same mistake: **quoting a sample
maximum as a property**. Tail statistics here are dominated by events at
roughly 1-in-3,000 to 1-in-40,000, so a 1,000-mission sweep does not see them
and a 28,000-mission sweep sees them about half the time. Any claim about a
worst case, a hang, or a timeout needs ≥3,000 missions to be worth stating and
its `n` printed beside it.

**Fourteen tests in this project have been found asserting nothing.** Break the
line a test covers, watch that specific test fail, restore. A test you have not
watched fail is not evidence.

**Babylon work cannot be verified in Node.** The reload clip's first build used
an accessor that does not exist in Babylon 9.18.1, matched zero targets, and
returned `null` for all eleven figures. Only the mandatory browser step caught
it. Clear the cache via CDP before trusting any browser measurement — a stale
bundle has produced false "verified" reports here.
