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

const BLEND = 0.15;      // seconds to cross-fade between clips
const WALK_MIN = 0.15;   // below this an agent reads as standing still
const RUN_MIN = 2.2;

// Within this many radians of dead-ahead/dead-astern of `facing`, an agent's
// actual travel direction reads as "forward" or "backward" respectively;
// anything wider than both is "sideways" (see directionalClip below).
const FACING_CONE = Math.PI / 4;

const CLIP_NAMES = ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right'];

function ownedGroups(skeleton, scene) {
  const nodes = new Set(skeleton.bones.map((b) => b.getTransformNode?.()).filter(Boolean));
  return scene.animationGroups.filter((g) => g.targetedAnimations.some((ta) => nodes.has(ta.target)));
}

/** A fresh per-clip weight/playing/started bookkeeping block for one rig
 * (one shared skeleton), same shape whether it is set up up front (SWAT,
 * hostiles) or later, the moment the hostage is rescued (see sync() below). */
function makeRig(skeleton, scene) {
  const groups = ownedGroups(skeleton, scene);
  return {
    groups: Object.fromEntries(CLIP_NAMES.map((n) => [n, groups.find((g) => g.name === n)])),
    // Per-clip weight, independent of any single "from -> to" pair. A clip
    // request just becomes the one name with target weight 1 (everything
    // else targets 0); a change of mind mid-fade is handled for free by
    // retargeting rather than needing to be detected and handled specially
    // — see crossfade() below.
    weight: Object.fromEntries(CLIP_NAMES.map((n) => [n, 0])),
    playing: new Set(),
    started: false,
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

export function bindAgents(scene, world, cast, orders) {
  // One clip set per SKELETON, not per figure: the pack shares a skeleton
  // between every figure built from the same model (four SWAT, seven
  // hostiles), so starting a clip for one starts it for all of them. The
  // hostage is excluded from clip playback ONLY — its floor pose is held by
  // written-back TransformNode values (see seated.js), and starting any clip
  // would overwrite those bone-local values and destroy the pose. Moving the
  // hostage's ROOT is fine and does not touch bone-local values at all, so
  // its position and facing are synced like every other agent below — the
  // hostage must be seen leaving with the squad for the rescue to read as
  // having happened. Its own rig is added later, the moment orders reports
  // the rescue — see the `hostageRig` handling in sync() below.
  const rigs = new Map();
  for (const fig of cast.figures) {
    if (fig.role === 'hostage') continue;
    if (rigs.has(fig.skeleton)) continue;
    rigs.set(fig.skeleton, makeRig(fig.skeleton, scene));
  }
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
          g.start(true, 1.0, g.from, g.to, false);
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
        g.start(true, 1.0, g.from, g.to, false);
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
        rigs.set(hostageFigure.skeleton, makeRig(hostageFigure.skeleton, scene));
      }

      // Clip choice per rig, from the fastest agent on that rig — with a shared
      // skeleton there is only one pose to give them, so a walking group should
      // look like it is walking. Direction (see directionalClip) is read off
      // that same fastest agent, not averaged across the rig's agents: the
      // shared skeleton can only show one pose at a time regardless, exactly
      // as speed already worked before directional clips existed.
      for (const [skeleton, rig] of rigs) {
        let fastest = null;
        for (let i = 0; i < world.agents.length; i++) {
          const a = world.agents[i];
          if (cast.figures[i]?.skeleton === skeleton && (!fastest || a.speed > fastest.speed)) fastest = a;
        }
        crossfade(rig, fastest ? directionalClip(fastest) : 'Idle', dt);
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
