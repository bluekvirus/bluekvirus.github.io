// Minimal headless stand-in for the three.js surface `themes/dune/troops.js`
// touches at module-load / createTroops() time. troops.js only imports
// three.js from a CDN import map (see index.html) — there is no local
// `three` package for bare `node --test` to resolve, and installing one just
// for a test would pull an unrelated real dependency into a static-site repo
// with no build step. Every class here is an inert store: no real matrix/
// quaternion math, because the attrition state machine's behavior (mode
// transitions, PRNG draws, alive/state fields) never reads geometry or
// matrix contents back — those exist purely for rendering, which this test
// doesn't exercise. See tests/helpers/three-min-loader.mjs for how this gets
// substituted for the real 'three' specifier.

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

export class Euler {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

export class Quaternion {
  setFromEuler() { return this; }
}

export class Matrix4 {
  makeTranslation() { return this; }
  compose() { return this; }
  copy() { return this; }
  multiply() { return this; }
}

class PositionAttribute {
  constructor(count) {
    this.count = count;
    this._x = new Float32Array(count);
    this._y = new Float32Array(count);
    this._z = new Float32Array(count);
  }
  getX(i) { return this._x[i]; }
  getY(i) { return this._y[i]; }
  getZ(i) { return this._z[i]; }
  setX(i, v) { this._x[i] = v; }
  setY(i, v) { this._y[i] = v; }
  setZ(i, v) { this._z[i] = v; }
}

// A real (if tiny) 8-corner box vertex set, so troops.js's taperY() — which
// scales bottom-half vertices in place — has real geometry to iterate over
// instead of crashing on an empty attribute.
class Geometry {
  constructor(count, w = 1, h = 1, d = 1) {
    this.attributes = { position: new PositionAttribute(count) };
    const hx = w / 2, hy = h / 2, hz = d / 2;
    let idx = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      if (idx >= count) break;
      this.attributes.position.setX(idx, sx * hx);
      this.attributes.position.setY(idx, sy * hy);
      this.attributes.position.setZ(idx, sz * hz);
      idx++;
    }
  }
  deleteAttribute() { return this; }
  rotateX() { return this; }
  rotateY() { return this; }
  rotateZ() { return this; }
  translate() { return this; }
  computeVertexNormals() { return this; }
}

export class BoxGeometry extends Geometry {
  constructor(w, h, d) { super(8, w, h, d); }
}
export class ConeGeometry extends Geometry {
  constructor(r, h, seg = 6) { super(seg + 2, r * 2, h, r * 2); }
}

export class MeshStandardMaterial {
  constructor(opts) { Object.assign(this, opts); }
}

export const DynamicDrawUsage = 'dynamic';

export class InstancedMesh {
  constructor(geometry, material, count) {
    this.geometry = geometry; this.material = material; this.count = count;
    this.instanceMatrix = { setUsage() {}, needsUpdate: false };
    this.castShadow = false; this.receiveShadow = false;
  }
  setMatrixAt() {}
}

export class Group {
  constructor() { this.children = []; }
  add(...objs) { this.children.push(...objs); return this; }
}

export function mergeGeometries() {
  return new Geometry(0);
}
