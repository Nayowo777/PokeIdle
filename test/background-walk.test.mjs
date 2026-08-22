import test from 'node:test';
import assert from 'node:assert/strict';
import { settleBackgroundWalk } from '../src/background-walk.js';

test('普通步行后台按时间增加总路程和后台统计', () => {
  const state = {
    walkingEnabled: true,
    walkPxPerSecond: 30,
    gameData: { stats: { walkDistance: 100 }, background: { stats: { walkDistance: 0 } }, gps: {} },
  };
  const result = settleBackgroundWalk({ state, from: 10_000, to: 70_000 });
  assert.equal(result.distance, 1800);
  assert.equal(result.state.gameData.stats.walkDistance, 1900);
  assert.equal(result.state.gameData.background.stats.walkDistance, 1800);
});

test('禁用步行、非法速度和非法时间段不产生路程', () => {
  for (const options of [
    { walkingEnabled: false, walkPxPerSecond: 30, from: 0, to: 1000 },
    { walkingEnabled: true, walkPxPerSecond: NaN, from: 0, to: 1000 },
    { walkingEnabled: true, walkPxPerSecond: 30, from: 1000, to: 0 },
  ]) {
    const state = { ...options, gameData: { stats: { walkDistance: 7 }, background: { stats: { walkDistance: 2 } } } };
    const result = settleBackgroundWalk({ state, ...options });
    assert.equal(result.distance, 0);
    assert.equal(result.state.gameData.stats.walkDistance, 7);
  }
});
