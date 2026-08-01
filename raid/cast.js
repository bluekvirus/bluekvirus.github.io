// Loading and placing the twelve figures.
//
// Each model (Swat.glb, Punk.glb, Casual.glb) is loaded once into an
// AssetContainer and then instantiated per figure via
// `container.instantiateModelsToScene()`. Unlike `TransformNode.clone()` —
// which does NOT clone the Skeleton of a skinned child mesh, so every clone
// of a template keeps pointing at that template's single shared Skeleton
// instance — `instantiateModelsToScene()` genuinely gives each instance its
// own Skeleton and its own AnimationGroups, retargeted onto that skeleton.
// So all 4 SWAT, all 7 hostiles, and the 1 hostage each own a distinct
// Skeleton: 12 Skeleton instances for 12 figures, not 3. `cloneMaterials:
// false` (the second argument to `instantiateModelsToScene`) keeps materials
// shared across instances of the same model — there is no reason for twelve
// copies of the same material. `skeletonsAreDistinct` below is asserted at
// the end of `populate` specifically so a future regression back toward
// shared skeletons fails loudly at startup rather than surfacing as "all the
// hostiles died at once".

import { layHostageOnFloor } from './seated.js';
import { facingToRotationY } from './facing.js';
import { attachWeapon } from './weapons.js';

const ASSET_DIR = '../assets/quaternius/';

const MODEL = {
  swat: 'Swat.glb',
  hostile: 'Punk.glb',
  hostage: 'Casual.glb',
};

// Every clip agents.js's CLIP_NAMES (raid/agents.js) or seated.js's Death
// lookup (raid/seated.js) will ever ask a figure's `groups` for by name.
// Kept here, not imported from agents.js, so cast.js can assert coverage
// without reaching into a renderer-binding module for a list — if either
// module starts looking a new clip up by name, add it here too.
const REQUIRED_CLIPS = ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Death'];

/**
 * Every figure must own its own skeleton. Four SWAT sharing one skeleton is
 * the pack's default (TransformNode.clone() does not clone a skinned mesh's
 * Skeleton) and it makes per-figure animation impossible: one hostile dying
 * would put all seven into the Death pose. Exported so the browser can assert
 * it rather than leaving it to be noticed on screen.
 */
export function skeletonsAreDistinct(figures) {
  const seen = new Set();
  for (const f of figures) {
    if (!f.skeleton || seen.has(f.skeleton)) return false;
    seen.add(f.skeleton);
  }
  return true;
}

/** Load one model into a container we can instantiate from repeatedly. */
async function loadContainer(scene, file) {
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(ASSET_DIR, file, scene);
  // The loader auto-starts clips on the container's own groups; those groups
  // are templates and must never play.
  for (const g of container.animationGroups) g.stop();
  return container;
}

/**
 * One independent copy: its own meshes, its own Skeleton, and its own
 * AnimationGroups retargeted onto that skeleton. This is the whole point of
 * instantiateModelsToScene over clone() — `cloneMaterials: false` keeps the
 * materials shared (there is no reason for twelve copies of the same
 * material), while skeletons and animation groups are genuinely per-instance.
 */
function instantiate(container, spawn, name) {
  const entries = container.instantiateModelsToScene((n) => `${name}_${n}`, false);
  const root = entries.rootNodes[0];
  root.setEnabled(true);
  root.position.set(spawn.x, 0, spawn.z);
  // Plain Euler assignment, not a rotationQuaternion — seated.js reads this
  // node's `.rotation.y` back out to derive the hostage's facing for its
  // pose. Switching this to a rotationQuaternion would leave `.rotation`
  // stale and silently break that pose with no error.
  //
  // `facingToRotationY` converts the sim's direction-of-travel angle to the
  // rotation.y this model actually needs — see facing.js for why a straight
  // `spawn.facing` assignment here would spawn every figure facing exactly
  // backward.
  root.rotation = new BABYLON.Vector3(0, facingToRotationY(spawn.facing ?? 0), 0);

  // instantiateModelsToScene runs every cloned entry's original name through
  // the naming callback above, and that is not limited to meshes/nodes — it
  // renames each AnimationGroup too (verified empirically: the container's
  // "Death" group comes back "swat_0_Death" on the instance). That gives
  // every figure a per-instance-unique group name, but leaves nothing
  // literally named "Death"/"Walk"/etc for agents.js's CLIP_NAMES lookup or
  // seated.js's `.find(g => g.name === 'Death')` to find. Restore the
  // canonical clip name on each instance's group, matching by array
  // position against the container's own (never-renamed) groups — verified
  // empirically that instantiateModelsToScene preserves array order between
  // `container.animationGroups` and `entries.animationGroups` one-for-one.
  //
  // That array-order correspondence is not a documented API guarantee, only
  // an empirical observation about this Babylon version, so it is checked
  // here rather than assumed silently. A length mismatch would make the
  // per-index rename below outright wrong (naming the wrong group after the
  // wrong clip); a missing required clip after renaming means a lookup by
  // name downstream (agents.js's CLIP_NAMES, seated.js's Death) would go
  // quietly undefined instead of erroring — `crossfade()` in agents.js
  // already guards `if (!g) continue`, so that failure would be silent, not
  // thrown, which is exactly the kind of regression `skeletonsAreDistinct`
  // exists to keep loud. Fail loudly here instead.
  if (entries.animationGroups.length !== container.animationGroups.length) {
    throw new Error(
      `cast: "${name}" instantiated ${entries.animationGroups.length} animation groups, ` +
      `template has ${container.animationGroups.length} — array-order rename is unsafe`
    );
  }
  entries.animationGroups.forEach((g, i) => {
    g.name = container.animationGroups[i].name;
  });
  const names = new Set(entries.animationGroups.map((g) => g.name));
  const missing = REQUIRED_CLIPS.filter((n) => !names.has(n));
  if (missing.length) {
    throw new Error(`cast: "${name}" is missing required animation group(s) after rename: ${missing.join(', ')}`);
  }

  const skinned = root.getChildMeshes().find((m) => m.skeleton);
  return {
    root,
    skeleton: skinned?.skeleton ?? entries.skeletons[0] ?? null,
    groups: entries.animationGroups,
    entries,
  };
}

export async function populate(scene, mission, shadows) {
  const containers = {};
  try {
    for (const [role, file] of Object.entries(MODEL)) {
      containers[role] = await loadContainer(scene, file);
    }
  } catch (err) {
    for (const c of Object.values(containers)) c.dispose();
    throw err;
  }

  const figures = [];
  const add = (role, spawn, i) => {
    const made = instantiate(containers[role], spawn, `${role}_${i}`);
    for (const m of made.root.getChildMeshes()) {
      if (m.getTotalVertices() > 0) {
        m.receiveShadows = true;
        shadows?.addShadowCaster(m);
      }
    }
    const spawnWeapon = spawn.weapon ?? 'none';
    // Pushed BEFORE attachWeapon runs, not after: attachWeapon throws when a
    // figure has no hand bone, and if that throw happens before this figure
    // is in `figures`, the catch block below (and its "dispose everything
    // built so far" sweep) never sees it — `made.root`'s meshes and
    // `made.entries.skeletons` would leak even though every other figure got
    // cleaned up. Pushing first, with `weaponMesh` still null, means a throw
    // here still leaves this figure disposable like any other.
    const figure = {
      root: made.root, skeleton: made.skeleton, groups: made.groups,
      role, entries: made.entries, weapon: spawnWeapon, weaponMesh: null,
    };
    figures.push(figure);
    figure.weaponMesh = attachWeapon(scene, { ...made, role }, spawnWeapon);
    if (figure.weaponMesh) shadows?.addShadowCaster(figure.weaponMesh);
  };

  // instantiate()/attachWeapon() both throw partway through a figure (a
  // missing required clip, a missing hand bone) and skeletonsAreDistinct
  // throws too. Any of those mid-loop leaves every figure already pushed —
  // its meshes, skeleton, animation groups, and any weapon mesh — with
  // nothing to dispose it: `figures` never reaches the return statement, so
  // the caller (main.js's uncaught `repopulate()` call) only ever sees the
  // rejection, not the leak. Tear down everything built so far before
  // rethrowing so a partial build doesn't leak into the scene.
  try {
    mission.spawns.swat.forEach((s, i) => add('swat', s, i));
    mission.spawns.hostiles.forEach((s, i) => add('hostile', s, i));
    add('hostage', mission.spawns.hostage, 0);

    if (!skeletonsAreDistinct(figures)) {
      throw new Error('cast: figures are sharing skeletons — per-figure animation is impossible');
    }
  } catch (err) {
    for (const f of figures) {
      f.weaponMesh?.dispose();
      for (const g of f.groups) g.dispose();
      for (const s of f.entries.skeletons) s.dispose();
      f.root.dispose(false, true);
    }
    for (const c of Object.values(containers)) c.dispose();
    throw err;
  }

  // The hostage is laid on the floor rather than left standing.
  //
  // Take the figure from `figures` itself, not from `scene.skeletons` by
  // index. An index into that array silently depends on load order, and
  // would start posing the wrong character the moment the model set or
  // import order changed.
  const hostage = figures.find((f) => f.role === 'hostage');
  // `standUp` restores the pre-floor-pose bone values captured by
  // layHostageOnFloor; agents.js calls it once the rescue actually happens
  // (see its `hostageRescued` handling), so it needs to live on the figure
  // agents.js already has a handle to, not just as a local here.
  hostage.standUp = layHostageOnFloor(hostage, scene).standUp;

  return {
    figures,
    dispose() {
      for (const f of figures) {
        f.weaponMesh?.dispose();
        for (const g of f.groups) g.dispose();
        // instantiateModelsToScene's Skeleton is not a child of `root` in the
        // scene graph and is not owned by the container — a mesh only
        // REFERENCES a skeleton, it does not own it, which is the very
        // reason the old shared-skeleton bug existed in the first place.
        // `root.dispose()` below never touches it, and nothing else in this
        // tree does either, so it must be disposed explicitly or it is
        // orphaned into `scene.skeletons` forever. Iterate `f.entries.skeletons`
        // (the authoritative set this instantiation created), not just
        // `f.skeleton`, in case a future model shape yields more than one.
        for (const s of f.entries.skeletons) s.dispose();
        f.root.dispose(false, true);
      }
      for (const c of Object.values(containers)) c.dispose();
    },
  };
}
