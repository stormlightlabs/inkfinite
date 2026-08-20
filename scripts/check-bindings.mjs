import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  boundsForShape,
  BUILTIN_SHAPE_KINDS,
  GEOMETRY_CONVENTION,
  validatePathGeometry,
  validateShapeProperties,
} from "../packages/bindings/dist/index.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/native/shape-registry.json", import.meta.url), "utf8"));

assert.deepEqual([...BUILTIN_SHAPE_KINDS], fixture.kind_names);
assert.deepEqual(GEOMETRY_CONVENTION, {
  coordinateSystem: fixture.geometry.coordinate_system,
  rotation: fixture.geometry.rotation,
  bounds: fixture.geometry.bounds,
});

for (const testCase of fixture.property_cases) {
  assert.equal(validateShapeProperties(testCase.kind, testCase.properties), testCase.valid, testCase.kind);
}

assert.ok(validatePathGeometry(fixture.path_geometry));

for (const testCase of fixture.geometry_cases) {
  const actual = boundsForShape({
    kind: testCase.kind,
    properties: testCase.properties,
    transform: testCase.transform,
  });
  for (const key of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(actual[key] - testCase.expected_bounds[key]) < 1e-9, `${key} differs`);
  }
}

const shape = fixture.serialization.shape;
const transaction = fixture.serialization.transaction;
assert.equal(shape.kind, "rect");
assert.equal(shape.transform.translation.x, transaction.operations[0].patch.transform.translation.x);
assert.equal(transaction.operations[0].type, "patch_shape");

console.log("generated TypeScript bindings conform to the native shared fixture");
