// Assembles a figure from a loadout config. This file knows how to wire item
// categories to sockets; it does not know how any individual item is shaped.
// There is ONE body — every figure is that body in a colourway plus items.

import { createBody } from './parts/body.js';
import { HEADGEAR } from './parts/headgear.js';
import { FACIAL } from './parts/facial.js';
import { EYEWEAR } from './parts/eyewear.js';
import { TORSO } from './parts/vests.js';
import { BACK } from './parts/packs.js';
import { WEAPONS } from './parts/weapons.js';
import { COLORWAYS } from './loadouts.js';
import { POSES, applyPose } from './poses.js';

// The item catalogue: category -> { library of factories, mount socket }.
// A genuinely new kind of gear is a new entry here; new variants of existing
// kinds go in the part modules.
export const CATEGORIES = {
  headgear: { lib: HEADGEAR, socket: 'head' },
  facial: { lib: FACIAL, socket: 'head' },
  eyewear: { lib: EYEWEAR, socket: 'head' },
  torso: { lib: TORSO, socket: 'chest' },
  back: { lib: BACK, socket: 'back' },
  weapon: { lib: WEAPONS, socket: 'handR' },
};

/**
 * @param {object} loadout - { body, pose, <category>: 'variant' | 'a,b' | [..] }
 *   `body` is a colourway name from loadouts.js or an inline slot map.
 * @returns {{ root, joints, sockets, meshes, weapon }} weapon is null if unarmed
 */
export function createSoldier({ scene, mats, loadout, parent }) {
  const { pose, body: bodySpec, ...items } = loadout;
  const colors = typeof bodySpec === 'string' ? COLORWAYS[bodySpec] : bodySpec;
  if (bodySpec && !colors) throw new Error(`Unknown body colourway "${bodySpec}"`);

  const body = createBody({ scene, mats, parent, colors });
  const meshes = [...body.meshes];
  let weapon = null;

  for (const [category, value] of Object.entries(items)) {
    if (!value) continue;
    const cat = CATEGORIES[category];
    if (!cat) throw new Error(`Unknown part category "${category}"`);

    // A category can stack items: 'chestRig,bandolier' or ['chestRig', ...].
    const variants = Array.isArray(value) ? value : String(value).split(',');
    for (const raw of variants) {
      const variant = raw.trim();
      if (!variant || variant === 'none') continue;
      const factory = cat.lib[variant];
      if (!factory) throw new Error(`Unknown ${category} variant "${variant}"`);

      const result = factory({ scene, mats, socket: body.sockets[cat.socket] });
      // Weapons return a descriptor; simple parts return a mesh array.
      if (Array.isArray(result)) {
        meshes.push(...result);
      } else {
        meshes.push(...result.meshes);
        weapon = result;
      }
    }
  }

  applyPose(body.joints, POSES[pose] ?? POSES.idle);

  return { root: body.root, joints: body.joints, sockets: body.sockets, meshes, weapon };
}
