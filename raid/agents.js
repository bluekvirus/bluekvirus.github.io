// Binds simulation agents to the rendered figures.
//
// The simulation is authoritative and knows nothing about meshes; this module
// only reads it. Positions are interpolated between the last two sim states so
// motion stays smooth no matter how the render frame rate relates to the fixed
// 1/60s step. Clip changes cross-fade over BLEND seconds of real (render)
// time, driven by the `dt` passed into sync() — that is deliberately a
// different clock than the sim step: this module runs at render rate, and the
// sim has no notion of wall-clock time at all.

import { facingToRotationY } from './facing.js';
import { SIM } from './sim/world.js';

const BLEND = 0.15;      // seconds to cross-fade between clips
const WALK_MIN = 0.15;   // below this an agent reads as standing still
const RUN_MIN = 2.2;

// Within this many radians of dead-ahead/dead-astern of `facing`, an agent's
// actual travel direction reads as "forward" or "backward" respectively;
// anything wider than both is "sideways" (see directionalClip below).
const FACING_CONE = Math.PI / 4;

// `Run_Shoot` (0.833s, per the pack) is deliberately not listed: it is not
// this pack's clip for "firing while moving" — `Gun_Shoot` is (see
// `combatClip` below) — and nothing here ever selects `Run_Shoot` itself.
// Every name that IS listed here must be reachable, or it belongs on this
// line, not in the rig: an unreachable entry costs every one of the twelve
// figures its own dead weight/playing bookkeeping for a clip nothing will
// ever request.
const CLIP_NAMES = [
  'Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right',
  'Idle_Gun_Pointing', 'Idle_Gun_Shoot', 'Gun_Shoot',
  'Sword_Slash', 'HitRecieve', 'Death',
];

/**
 * How long a one-shot combat clip keeps being requested after the sim event
 * that triggered it, in SIM TICKS — derived from the clip's own recorded
 * length rather than a single guessed constant, because one constant read
 * across clips of very different lengths can only be right for one of them:
 * an earlier version of this file used a flat 18/24-tick window for every
 * firing/flinch clip and every one of them but `HitRecieve` (close by
 * coincidence) visibly cut short and blended back to idle mid-motion.
 * Measured directly against the pinned Babylon 9.18.1 + this asset pack,
 * identical across all three GLBs actually used (Swat.glb, Punk.glb,
 * Casual.glb — confirmed by reading `group.from`/`.to` off each of a SWAT,
 * a hostile, and the hostage figure's own rig, not assumed from one):
 *
 *   Gun_Shoot       0.600s
 *   Idle_Gun_Shoot  0.667s
 *   Sword_Slash     1.033s
 *   HitRecieve      0.567s
 *   Death           1.067s (held, not windowed — Death never expires, see startClip below)
 *
 * `AnimationGroup.from`/`.to` are frame numbers, not seconds, and every clip
 * in this pack runs at 60fps (`targetedAnimations[0].animation
 * .framePerSecond`, read directly rather than assumed) — `(to - from) / fps`
 * recovers real seconds straight from the asset, then converts to ticks
 * against `SIM.step`. Computed once per rig in makeRig() below rather than
 * per frame: it depends only on the clip, not on anything that changes
 * tick to tick. This is deliberately read from the actual loaded
 * `AnimationGroup`, not hand-copied from the measurements above, so a
 * future asset swap with different clip lengths (or even a different fps)
 * stays correct automatically instead of silently reintroducing the
 * cut-short bug this replaces. (Babylon 9.18.1 exposes everything this
 * needs directly on the group, so no fallback to a hand-maintained
 * per-clip constant table was needed — the measurements above are recorded
 * for documentation, not because the code depends on them.)
 */
function clipDurationTicks(group) {
  const fps = group?.targetedAnimations[0]?.animation?.framePerSecond;
  if (!group || !fps) return 0; // missing/malformed clip: request it for 0 ticks rather than loop forever or crash
  return Math.round(((group.to - group.from) / fps) / SIM.step);
}

/** A fresh per-clip weight/playing/started bookkeeping block for one rig
 * (one figure's own skeleton and groups), same shape whether it is set up up
 * front (SWAT, hostiles) or later, the moment the hostage is rescued (see
 * sync() below). */
function makeRig(figure) {
  const groups = Object.fromEntries(CLIP_NAMES.map((n) => [n, figure.groups.find((g) => g.name === n)]));
  return {
    groups,
    // Per-clip one-shot request window, in sim ticks — see
    // clipDurationTicks above. Computed once here, from this rig's own
    // groups, not shared across figures: every figure in this pack happens
    // to measure identically, but nothing here assumes that has to stay true.
    durationTicks: Object.fromEntries(CLIP_NAMES.map((n) => [n, clipDurationTicks(groups[n])])),
    // Per-clip weight, independent of any single "from -> to" pair. A clip
    // request just becomes the one name with target weight 1 (everything
    // else targets 0); a change of mind mid-fade is handled for free by
    // retargeting rather than needing to be detected and handled specially
    // — see crossfade() below.
    weight: Object.fromEntries(CLIP_NAMES.map((n) => [n, 0])),
    playing: new Set(),
    started: false,
    // Which firing/striking clip is currently in flight, and the `firedAt`
    // tick it was chosen for — see combatClip's latch handling below. Both
    // start at their "nothing has happened yet" values; `agent.firedAt`
    // itself starts at -1 for an agent that has never fired, so the latch
    // only ever activates on a genuine attack (see the `>= 0` guard below).
    fireLatch: { clip: null, firedAt: -1 },
  };
}

/**
 * Which clip a single representative agent's motion calls for, from the
 * angle between where it is actually travelling (`atan2(vx, vz)` — the same
 * atan2(x, z) convention `facing` itself uses) and where its body is
 * currently oriented (`facing`). The two need not agree: the sim's turnRate
 * smoothing lags `facing` behind a sudden change in travel direction, and
 * the right-of-way yield in world.js can point velocity squarely opposite
 * facing — and it is exactly that divergence the directional clips exist to
 * show, instead of a forward walk cycle playing while the figure slides
 * sideways or backward.
 *
 * Left/right resolved by direct measurement, not by eye or by re-deriving
 * the angle's sign again: with a figure's `facing` pinned to 0 (model front
 * along world -Z — see facing.js), its own Shoulder.L sits at positive
 * local X and Shoulder.R at negative local X, and working through the
 * cross(up, forward) that follows from that placement puts the character's
 * own RIGHT on the world -X side at facing 0. A velocity rotated +PI/2 from
 * facing (`rel` below `= +PI/2`) works out to world +X — i.e. the
 * character's own LEFT. So a positive `rel` (travel direction ahead of
 * facing in the atan2(x, z) sweep) means the agent is moving toward its own
 * left: Run_Left. Negative `rel` is Run_Right. Verified directly against
 * the running scene: forcing an agent's velocity 90 degrees left of its
 * facing and reading the clip choice back confirms Run_Left, not Run_Right.
 */
function directionalClip(agent) {
  if (agent.speed < WALK_MIN) return 'Idle';
  const travel = Math.atan2(agent.vx, agent.vz);
  let rel = travel - agent.facing;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  const abs = Math.abs(rel);
  if (abs <= FACING_CONE) return agent.speed < RUN_MIN ? 'Walk' : 'Run';
  if (abs >= Math.PI - FACING_CONE) return 'Run_Back';
  return rel > 0 ? 'Run_Left' : 'Run_Right';
}

/**
 * Which clip an agent calls for, combat first. Order matters and is a
 * priority, not a sequence: a dying agent is not also flinching, and an agent
 * that is firing should be seen firing even though it is technically also
 * standing still.
 *
 * `world.ticks` is passed in because the sim records combat events as tick
 * stamps rather than as durations — it has no notion of how long anything
 * should be shown for, which is exactly right for a module that must run
 * headless at 340k ticks/s. `durations` is this agent's own rig's
 * `durationTicks` (see clipDurationTicks above) — a clip stays requested for
 * exactly its own real length, not a borrowed constant. `latch` is this
 * agent's own rig's `fireLatch` (see makeRig above), mutated in place here —
 * see the block below for why this function needs to remember something
 * across calls at all, not just read the agent's current fields.
 *
 * Firing/striking clips are LATCHED, not gated on live agent state. The
 * first version of this fix (round 1) gated every firing clip on
 * `agent.target >= 0`, reasoning that combat.js clears `target` to -1 almost
 * immediately once it is no longer valid. That reasoning was correct but
 * misapplied: `combat.js` clears the ATTACKER's own `target` to -1 on the
 * very next tick after ITS OWN SHOT kills its target (see `kill()` in
 * sim/combat.js, called from `attack()`) — which means the single most
 * common way for `target` to go stale is the attacker landing a killing
 * blow, i.e. exactly the moment the animation matters most. Gating on
 * `target >= 0` cut every killing blow's clip off after ~1 tick and
 * cross-faded back to idle — reintroducing, for kills specifically, the
 * "cut off mid-motion" symptom the duration-derivation fix above exists to
 * remove.
 *
 * The fix is to decide which clip to show only ONCE per attack, the moment
 * `agent.firedAt` changes to a value this rig has not latched before, and
 * then hold that decision for the clip's own full duration regardless of
 * what `target` or `speed` do in the meantime. `combat.js` only ever
 * advances `firedAt` inside `attack()`, so a changed `firedAt` alone already
 * means "an attack just happened" — no additional `target` check is needed
 * to know a NEW window may begin. Latching also fixes a second flicker: an
 * agent that starts firing stationary and then, mid-window, has its target
 * retreat out of `gunRange` while staying within `sightRange` (un-halting
 * it — see the `!a.chasing && distance <= rangeOf(a)` branch in
 * sim/world.js) would otherwise re-evaluate speed every frame and swap
 * `Idle_Gun_Shoot` for `Gun_Shoot` mid-swing.
 */
function combatClip(agent, ticks, durations, latch) {
  if (!agent.alive) return 'Death';
  if (agent.hitAt >= 0 && ticks - agent.hitAt < durations.HitRecieve) return 'HitRecieve';

  if (agent.firedAt >= 0 && agent.firedAt !== latch.firedAt) {
    // A new attack (hit or miss — `attack()` sets `firedAt` regardless)
    // fired since this rig last looked. Decide the clip once, from
    // whatever `target`/`weapon`/`speed` were at the moment it was noticed,
    // and remember it: sim/world.js halts a gun agent's velocity to exactly
    // 0 the instant it is in range with a valid target (chasing is
    // melee-only, so this never applies to a melee agent), so stationary is
    // the ordinary firing case for a gun and moving is the rare one — the
    // mapping below puts the pack's dedicated standing-fire clip on the
    // common case, matching the design spec's own table.
    latch.firedAt = agent.firedAt;
    latch.clip = agent.weapon === 'melee'
      ? 'Sword_Slash'
      : agent.speed < WALK_MIN ? 'Idle_Gun_Shoot' : 'Gun_Shoot';
  }
  if (latch.clip && ticks - latch.firedAt < durations[latch.clip]) return latch.clip;

  // Holding a target but between shots: weapon up, not slack at the side.
  if (agent.target >= 0 && agent.weapon === 'gun' && agent.speed < WALK_MIN) {
    return 'Idle_Gun_Pointing';
  }
  return directionalClip(agent);
}

export function bindAgents(scene, world, cast, orders, agentDiscs = []) {
  // One rig per FIGURE now, not per skeleton. Every figure owns its skeleton
  // and its animation groups (see cast.js), so the old "four SWAT share one
  // pose, drive it from the fastest of them" constraint is gone — which is
  // what makes it possible for one agent to fire while another sprints, and
  // for one hostile to die without taking the other six down with it. The
  // hostage is excluded from clip playback ONLY — its floor pose is held by
  // written-back TransformNode values (see seated.js), and starting any clip
  // would overwrite those bone-local values and destroy the pose. Moving the
  // hostage's ROOT is fine and does not touch bone-local values at all, so
  // its position and facing are synced like every other agent below — the
  // hostage must be seen leaving with the squad for the rescue to read as
  // having happened. Its own rig is added later, the moment orders reports
  // the rescue — see the `hostageRescued` handling in sync() below.
  const rigs = new Map(); // agent index -> rig
  cast.figures.forEach((fig, i) => {
    if (fig.role === 'hostage') return; // floor pose; its rig is added on rescue
    rigs.set(i, makeRig(fig));
  });
  const hostageFigure = cast.figures.find((fig) => fig.role === 'hostage');
  let hostageRescued = false;

  const previous = world.agents.map((a) => ({ x: a.x, z: a.z, facing: a.facing }));

  // Ramps `rig` toward playing `name` at full weight, fading everything else
  // on the same rig out, over BLEND seconds of real elapsed time (`dt`,
  // seconds). Every group's RAW weight is driven independently toward its
  // own target (1 for `name`, 0 for the rest) rather than tracking a single
  // in-flight pair, so a retarget that lands before the previous fade
  // finished does not need to be detected or handled specially — it is just
  // a new target for the per-group ramp to head toward.
  //
  // That independence is exactly why a naive "apply the raw weight directly"
  // version is wrong: two retargets inside one BLEND window (e.g. Run
  // requested while Idle->Walk was still mid-fade — a routine deceleration
  // through Run -> Walk -> Idle causes this, not an edge case) can leave
  // three raw weights simultaneously nonzero, e.g. 0.4/0.2/0.2, summing to
  // 0.8 rather than 1 — a visibly mis-weighted three-way blend rather than a
  // clean cross-fade. So the raw per-group ramp above is a bookkeeping step
  // only: what is actually handed to Babylon is renormalised every call so
  // the currently-playing groups' weights always sum to exactly 1, however
  // many of them are mid-fade and whatever `dt` arrives. This is robust to
  // any number of in-flight groups (three, four, a chain of retargets), not
  // just two, which is what makes it safe against a `dt`/retarget timing the
  // caller cannot control. Babylon genuinely blends by weight — verified
  // directly against this project's pinned Babylon 9.18.1, see the Task 6
  // fix report — so a normalised three-way split still renders as a single
  // coherent pose, just briefly a three-way rather than two-way mix. A group
  // is only stopped once its RAW weight reaches exactly 0 (never based on
  // its post-normalisation value), so it never snaps to bind pose mid-fade.
  // Death is the one clip that must not loop — a corpse repeatedly collapsing
  // is the kind of thing that reads as a bug from across the room. Playing it
  // non-looping leaves Babylon holding the final frame, which is exactly the
  // pose wanted.
  //
  // That is safe with crossfade's bookkeeping below, but only by a margin
  // worth keeping in mind on a future asset swap. Once Babylon self-completes
  // a non-looping group, `rig.playing` is left stale (still says the clip is
  // playing — nothing here calls `stop()` on it), so crossfade keeps calling
  // `setWeightForAllAnimatables` on a group with zero animatables left every
  // frame after that; that is a harmless no-op, and `if (w === target)
  // continue` above stops it from ever trying to re-`start()` the same clip.
  // The margin is that this only holds because Death (1.067s) is far longer
  // than BLEND (0.15s): the raw weight ramp always finishes climbing to 1
  // well before the clip itself self-completes, so `rig.playing` never goes
  // stale WHILE the raw weight is still mid-fade — if it did, the
  // renormalisation sum below would be dividing by a stale `playing` set
  // that no longer matches which groups are actually still ramping, a
  // phantom-weight race. A future Death clip shorter than roughly BLEND
  // would reopen exactly that race and would need either a longer BLEND or
  // an explicit "did Babylon finish this on its own" check here.
  const startClip = (g, name) => g.start(name !== 'Death', 1.0, g.from, g.to, false);

  const crossfade = (rig, name, dt) => {
    if (!rig.started) {
      // Nothing has ever played on this rig: snap straight to the first
      // clip instead of fading in from bind pose, which would just be a
      // silent hold rather than a visible cross-fade anyway.
      rig.started = true;
      for (const [n, g] of Object.entries(rig.groups)) {
        if (!g) continue;
        rig.weight[n] = n === name ? 1 : 0;
        if (n === name) {
          startClip(g, n);
          g.setWeightForAllAnimatables(1);
          rig.playing.add(n);
        }
      }
      return;
    }

    const step = BLEND > 0 ? dt / BLEND : 1;
    for (const [n, g] of Object.entries(rig.groups)) {
      if (!g) continue;
      const target = n === name ? 1 : 0;
      let w = rig.weight[n];
      if (w === target) continue;
      if (target === 1 && !rig.playing.has(n)) {
        startClip(g, n);
        rig.playing.add(n);
      }
      w = target === 1 ? Math.min(1, w + step) : Math.max(0, w - step);
      rig.weight[n] = w;
      if (w === 0 && rig.playing.has(n)) {
        g.stop();
        rig.playing.delete(n);
      }
    }

    // Renormalise so whatever is actually playing always sums to weight 1
    // — see the block comment above for why the raw per-group ramp above
    // cannot be handed to Babylon directly.
    let sum = 0;
    for (const n of Object.keys(rig.groups)) sum += rig.weight[n];
    for (const [n, g] of Object.entries(rig.groups)) {
      if (!g || !rig.playing.has(n)) continue;
      g.setWeightForAllAnimatables(sum > 0 ? rig.weight[n] / sum : 0);
    }
  };

  return {
    /** Called before each sim step, to remember where things were. */
    snapshot() {
      world.agents.forEach((a, i) => {
        previous[i].x = a.x;
        previous[i].z = a.z;
        previous[i].facing = a.facing;
      });
    },

    /**
     * @param alpha 0..1 through the current fixed sim step; drives position
     *   and facing interpolation between the last two sim states.
     * @param dt real (render) seconds elapsed since the previous sync() call;
     *   drives the animation cross-fade ramp. Unrelated clocks: alpha resets
     *   every sim step regardless of render rate, dt does not.
     */
    sync(alpha, dt) {
      // Every agent's root is moved, INCLUDING the hostage: translating the
      // root only changes where the figure sits in the world, not any
      // bone-local transform, so the floor pose from seated.js survives the
      // move untouched. Only clip playback (the `rigs` loop below) excludes
      // the hostage.
      for (let i = 0; i < world.agents.length; i++) {
        const a = world.agents[i];
        const fig = cast.figures[i];
        if (!fig) continue;
        const p = previous[i];
        fig.root.position.x = p.x + (a.x - p.x) * alpha;
        fig.root.position.z = p.z + (a.z - p.z) * alpha;

        // The role marker rides along under the figure. Its x/z are copied
        // rather than the disc being parented to `fig.root`, because that
        // root carries the glTF import's mirrored (1,1,-1) scaling — the
        // same handedness flip that facing.js exists to undo — and hanging
        // more geometry off it is how that flip spreads. Its own y is left
        // alone: the disc sits just above the floor, not at hip height.
        const disc = agentDiscs[i];
        if (disc) {
          disc.position.x = fig.root.position.x;
          disc.position.z = fig.root.position.z;
        }

        let delta = a.facing - p.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        fig.root.rotation.y = facingToRotationY(p.facing + delta * alpha);
      }

      // The moment the squad actually reaches the hostage (ground truth from
      // orders.js, not just `phase === 'done'` — see the field comment on
      // `hostageReached` there), the floor pose is done its job: put the
      // bones back the way seated.js found them and fold the hostage's own
      // (unshared) skeleton into `rigs` so it gets a clip like everyone else
      // from here on. Gated on a local flag, not re-checked once true, so
      // this fires exactly once per cast even though sync() runs every frame.
      if (!hostageRescued && hostageFigure && orders?.hostageReached) {
        hostageRescued = true;
        hostageFigure.standUp();
        rigs.set(cast.figures.indexOf(hostageFigure), makeRig(hostageFigure));
      }

      // Clip choice per figure now that every figure owns its own skeleton
      // and groups — no more picking a single "fastest agent" to represent a
      // whole shared rig.
      for (const [i, rig] of rigs) {
        const a = world.agents[i];
        crossfade(rig, a ? combatClip(a, world.ticks, rig.durationTicks, rig.fireLatch) : 'Idle', dt);
      }
    },

    dispose() {
      for (const rig of rigs.values()) {
        for (const g of Object.values(rig.groups)) g?.stop();
      }
      rigs.clear();
    },
  };
}
