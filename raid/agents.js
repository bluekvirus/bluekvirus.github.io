// Binds simulation agents to the rendered figures.
//
// The simulation is authoritative and knows nothing about meshes; this module
// only reads it. Positions are interpolated between the last two sim states so
// motion stays smooth no matter how the render frame rate relates to the fixed
// 1/60s step.

const BLEND = 0.15;      // seconds to cross-fade between clips
const WALK_MIN = 0.15;   // below this an agent reads as standing still
const RUN_MIN = 2.2;

function ownedGroups(skeleton, scene) {
  const nodes = new Set(skeleton.bones.map((b) => b.getTransformNode?.()).filter(Boolean));
  return scene.animationGroups.filter((g) => g.targetedAnimations.some((ta) => nodes.has(ta.target)));
}

export function bindAgents(scene, world, cast) {
  // One clip set per SKELETON, not per figure: the pack shares a skeleton
  // between every figure built from the same model (four SWAT, seven
  // hostiles), so starting a clip for one starts it for all of them. The
  // hostage is excluded entirely — its floor pose is held by written-back
  // TransformNode values (see seated.js) and starting any clip on it would
  // destroy that pose.
  const rigs = new Map();
  for (const fig of cast.figures) {
    if (fig.role === 'hostage') continue;
    if (rigs.has(fig.skeleton)) continue;
    const groups = ownedGroups(fig.skeleton, scene);
    rigs.set(fig.skeleton, {
      groups: Object.fromEntries(['Idle', 'Walk', 'Run'].map((n) => [n, groups.find((g) => g.name === n)])),
      current: null,
    });
  }

  const previous = world.agents.map((a) => ({ x: a.x, z: a.z, facing: a.facing }));

  const play = (rig, name) => {
    if (rig.current === name) return;
    const next = rig.groups[name];
    if (!next) return;
    for (const [n, g] of Object.entries(rig.groups)) {
      if (!g || n === name) continue;
      g.stop();
    }
    next.start(true, 1.0, next.from, next.to, false);
    next.setWeightForAllAnimatables(1);
    rig.current = name;
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

    sync(alpha) {
      for (let i = 0; i < world.agents.length; i++) {
        const a = world.agents[i];
        const fig = cast.figures[i];
        if (!fig || fig.role === 'hostage') continue;
        const p = previous[i];
        fig.root.position.x = p.x + (a.x - p.x) * alpha;
        fig.root.position.z = p.z + (a.z - p.z) * alpha;

        let delta = a.facing - p.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        fig.root.rotation.y = p.facing + delta * alpha;
      }

      // Clip choice per rig, from the fastest agent on that rig — with a shared
      // skeleton there is only one pose to give them, so a walking group should
      // look like it is walking.
      for (const [skeleton, rig] of rigs) {
        let fastest = 0;
        for (let i = 0; i < world.agents.length; i++) {
          if (cast.figures[i]?.skeleton === skeleton) fastest = Math.max(fastest, world.agents[i].speed);
        }
        play(rig, fastest < WALK_MIN ? 'Idle' : fastest < RUN_MIN ? 'Walk' : 'Run');
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
