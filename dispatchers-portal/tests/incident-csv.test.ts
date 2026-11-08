import { test } from "node:test";
import assert from "node:assert/strict";
import { previewRidersCsv, RIDER_CSV_EXAMPLE } from "../src/incident/csv";
import { ringsForPoints, validateZone } from "../../shared/incident";

test("CSV preview preserves quoted addresses and explicit false/unknown values", () => {
  const csv = previewRidersCsv('\uFEFF' + RIDER_CSV_EXAMPLE.replace('Demo resident', '"Resident ""A"", family"'));
  assert.deepEqual(csv.errors, []);
  assert.equal(csv.riders[0].name, 'Resident "A", family');
  assert.equal(csv.riders[0].address, "502 Montrose, Houston TX 77019");
  assert.equal(csv.riders[0].oxygen, false);
  assert.equal(csv.riders[0].needProbability, undefined);
});
test("CSV errors block import instead of accepting a partially invalid roster", () => {
  const [header, row] = RIDER_CSV_EXAMPLE.trim().split('\n');
  const duplicate = previewRidersCsv(`${header}\n${row}\n${row}\n`);
  assert.equal(duplicate.errors.length, 1);
  assert.match(duplicate.errors[0], /Row 3.*Duplicate rider ID/);
  for (const [before, after] of [["29.76123664", "NaN"], ["+18325550100", "8325550100"], ["2,false", "0,false"], ["2,false", "2,perhaps"], ["wheelchair", "flying"]]) {
    assert.ok(previewRidersCsv(RIDER_CSV_EXAMPLE.replace(before, after)).errors.length, after);
  }
  assert.match(previewRidersCsv('rider_id,name\na,"unclosed').errors[0], /not closed/);
});
test("zone previews close a valid boundary and reject crossing, empty and non-finite polygons", () => {
  const rings = ringsForPoints([{ lat: 29.75, lng: -95.4 }, { lat: 29.77, lng: -95.4 }, { lat: 29.77, lng: -95.38 }]);
  assert.deepEqual(rings[0][0], rings[0][3]);
  assert.throws(() => validateZone([[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]), /cross/);
  assert.throws(() => validateZone([[[0, 0], [1, 0], [2, 0], [0, 0]]]), /area/);
  assert.throws(() => validateZone([[[0, 0], [Infinity, 1], [1, 0], [0, 0]]]), /coordinates/);
});
