import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceGpsDistance } from '../src/gps-distance.js';

test('GPS 纯数据推进可在单段内扣减剩余距离', () => {
  const gps = { curIdx: 2, destIdx: 1, path: [2, 1], seg: 0, totalPx: 1000, remainPx: 1000, units: 1, roamEnabled: false, massTarget: null, massArrived: false };
  const result = advanceGpsDistance(250, gps);
  assert.equal(result.consumed, 250);
  assert.equal(result.state.remainPx, 750);
  assert.equal(result.state.destIdx, 1);
});

test('GPS 纯数据推进可跨越多个路线段并停止在普通目的地', () => {
  const gps = { curIdx: 2, destIdx: 3, path: [2, 1, 3], seg: 0, totalPx: 100, remainPx: 100, units: 1, roamEnabled: false, massTarget: null, massArrived: false };
  const result = advanceGpsDistance(250, gps);
  assert.equal(result.state.curIdx, 3);
  assert.equal(result.state.destIdx, null);
  assert.equal(result.state.path, null);
  assert.equal(result.consumed, 200);
});
