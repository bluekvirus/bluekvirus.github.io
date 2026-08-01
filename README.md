bluekvirus.github.io
====================

Tim Lauv's Open Source activity press.

## raid/ — procedural CQB map generator

Seeded office floor plans for a hostage-rescue scenario: 4 SWAT, 7 hostiles and
1 hostage placed on a generated building, viewed roofless at 45°.

Open `raid/` and use the HUD to set a seed, change the room count, or shuffle.
The same seed always produces the same map.

Generation is pure data — `rng.js`, `floorplan.js`, `roles.js` and `furnish.js`
import nothing from Babylon and run under Node:

    node --test

The suite asserts determinism, connectivity, room sizes, door clearances and
spawn placement across 200 seeds, plus the generation budget (100 timed runs)
and every room count the HUD offers (5 counts x 40 seeds each).

The mission itself — navigation, steering, doors, orders — is also pure data
under `sim/`, so the same `node --test` run plays the whole thing out headless:
no Babylon, no DOM, no screen. That is what makes `dryrun.test.js` possible —
it steps a full mission to completion on every room count, checks every
single tick for wall-clipping and closed-door-clipping, and then confirms the
squad genuinely reached the hostage, opened doors, and covered real ground
rather than merely reporting done, something no amount of watching the 3D
view could establish. It is also what
keeps a machine-learning environment on the table later: a simulation that
already runs headless and deterministic needs no new harness to be steppable
by a training loop instead of a HUD.
