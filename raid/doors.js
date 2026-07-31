// Swings door meshes to match simulation state.
//
// The simulation owns whether a door is open; this module only reacts. That
// split is what lets the whole thing run headless with no meshes at all.

const OPEN_ANGLE = Math.PI / 2 * 0.92;

export function bindDoors(scene, world, leaves) {
  const byId = new Map(leaves.map((m) => [Number(m.name.split('_')[1]), m]));
  const rest = new Map([...byId].map(([id, m]) => [id, m.rotation.y]));

  return {
    sync() {
      for (const d of Object.values(world.doors)) {
        const mesh = byId.get(d.id);
        if (!mesh) continue;
        // Progress comes from the door's own timer, so the swing matches the
        // simulation exactly rather than running on its own clock and drifting.
        const t = d.state === 'open' ? 1
          : d.state === 'opening' ? Math.min(1, d.timer / 0.4)
          : 0;
        mesh.rotation.y = rest.get(d.id) + OPEN_ANGLE * t;
      }
    },
    dispose() { byId.clear(); rest.clear(); },
  };
}
