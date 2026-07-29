// Shared primitive helpers. Every part builds from these so proportions,
// bevels and pivot conventions stay consistent across the library.
//
// Convention: parts are authored in metres with the figure ~1.8 tall, Y up,
// facing +Z. A part's own origin sits at its natural attachment point (a
// thigh's origin is its hip, not its centre) so joints rotate correctly.

/**
 * A box whose origin is at an arbitrary anchor rather than its centre.
 * anchor is a [x,y,z] triple in -1..1 box-space: [0,1,0] anchors at the top face.
 */
export function box(name, { size, anchor = [0, 0, 0], pos = [0, 0, 0], mat, scene, parent }) {
  const [w, h, d] = size;
  const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  // Shift geometry so the mesh origin lands on the requested anchor.
  m.bakeTransformIntoVertices(
    BABYLON.Matrix.Translation(
      (-anchor[0] * w) / 2,
      (-anchor[1] * h) / 2,
      (-anchor[2] * d) / 2,
    ),
  );
  m.position.set(pos[0], pos[1], pos[2]);
  if (mat) m.material = mat;
  if (parent) m.parent = parent;
  return m;
}

/** A tapered block — a box with independently scaled top and bottom faces. */
export function taperedBox(name, { bottom, top, height, anchor = [0, 1, 0], pos = [0, 0, 0], mat, scene, parent }) {
  const [bw, bd] = bottom;
  const [tw, td] = top;
  const h = height;
  const y0 = anchor[1] === 1 ? -h : anchor[1] === -1 ? 0 : -h / 2;
  const y1 = y0 + h;
  const hx = [bw / 2, tw / 2];
  const hz = [bd / 2, td / 2];

  // 8 corners: 0-3 bottom (y0), 4-7 top (y1), CCW from -x-z.
  const p = [
    [-hx[0], y0, -hz[0]], [hx[0], y0, -hz[0]], [hx[0], y0, hz[0]], [-hx[0], y0, hz[0]],
    [-hx[1], y1, -hz[1]], [hx[1], y1, -hz[1]], [hx[1], y1, hz[1]], [-hx[1], y1, hz[1]],
  ];
  const quads = [
    [0, 1, 2, 3].reverse(), // bottom
    [4, 5, 6, 7], // top
    [0, 1, 5, 4], // -z
    [1, 2, 6, 5], // +x
    [2, 3, 7, 6], // +z
    [3, 0, 4, 7], // -x
  ];

  const positions = [];
  const indices = [];
  for (const q of quads) {
    const base = positions.length / 3;
    for (const i of q) positions.push(p[i][0], p[i][1], p[i][2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const m = new BABYLON.Mesh(name, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = positions;
  vd.indices = indices;
  const normals = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(m);
  m.position.set(pos[0], pos[1], pos[2]);
  if (mat) m.material = mat;
  if (parent) m.parent = parent;
  return m;
}

/** A named joint. Parts parent to these; animation rotates them. */
export function joint(name, { pos = [0, 0, 0], scene, parent }) {
  const n = new BABYLON.TransformNode(name, scene);
  n.position.set(pos[0], pos[1], pos[2]);
  if (parent) n.parent = parent;
  return n;
}
