// Node module-customization hook (register()'d from the test file before
// dynamically importing troops.js) that redirects the two three.js
// specifiers troops.js imports to the headless stubs in this directory.
// Everything else resolves normally. See three-min-stub.mjs for rationale.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const threeUrl = pathToFileURL(path.join(dir, 'three-min-stub.mjs')).href;
const bguUrl = pathToFileURL(path.join(dir, 'buffer-geometry-utils-min-stub.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
  if (specifier === 'three/addons/utils/BufferGeometryUtils.js') {
    return { url: bguUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
