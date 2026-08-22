import test from 'node:test';
import assert from 'node:assert/strict';
import { settleIncubatorProgress } from '../src/incubator-progress.js';

test('后台新增路程达到阈值时只标记孵化完成', () => {
  const gameData = {
    stats: { walkDistance: 900 },
    incubators: [{ eggIndex: 1, hatchStart: 0, hatchDuration: 1000, hatched: false }],
  };
  const result = settleIncubatorProgress(gameData, { hatchMultiplier: 1, walkDistance: 1100 });
  assert.equal(result.changed, true);
  assert.equal(result.hatched, 1);
  assert.equal(result.gameData.incubators[0].hatched, true);
  assert.equal(result.gameData.stats.totalEggsHatched, undefined);
});
test('没有导航时仍按总路程孵蛋，并保留 100 像素容差', () => {
  const result = settleIncubatorProgress({ stats: { walkDistance: 999 }, incubators: [{ eggIndex: 1, hatchStart: 0, hatchDuration: 1000, hatched: false }] }, { hatchMultiplier: 1, walkDistance: 999 });
  assert.equal(result.changed, true);
});
