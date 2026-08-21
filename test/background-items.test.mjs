import test from 'node:test';
import assert from 'node:assert/strict';

import { settleBackgroundItems } from '../src/background-items.js';
import { settleBackgroundSlice } from '../src/background-settlement.js';

function data(overrides = {}) {
  return {
    items: {},
    stats: { totalItemsEarned: {} },
    systemLogs: [],
    background: { stats: { items: {}, itemDrops: 0 } },
    ...overrides,
  };
}

test('后台道路按时间获得糖果和精灵球并同步统计', () => {
  const gameData = data();
  const state = { gameData, balls: {} };
  const result = settleBackgroundItems({
    state,
    from: 0,
    to: 2_000,
    itemRates: { candy: 0.5, 'poke-ball': 0.5 },
    candyMultipliers: [{ mult: 2, weight: 1 }],
    random: () => 0,
    enabled: true,
  });

  assert.deepEqual(result.items, { candy: 2, 'poke-ball': 1 });
  assert.deepEqual(result.drops, { candy: 1, 'poke-ball': 1 });
  assert.equal(gameData.items.candy, 2);
  assert.equal(gameData.items['poke-ball'], 1);
  assert.equal(state.balls['poke-ball'], 1);
  assert.equal(gameData.stats.totalItemsEarned.candy, 2);
  assert.equal(gameData.background.stats.itemDrops, 2);
});

test('每次糖果掉落实例独立抽取数量倍率', () => {
  const gameData = data();
  const values = [0, 0.75];
  const result = settleBackgroundItems({
    state: { gameData, balls: {} },
    from: 0,
    to: 2_000,
    itemRates: { candy: 1 },
    candyMultipliers: [{ mult: 1, weight: 1 }, { mult: 5, weight: 1 }],
    random: () => values.shift(),
    enabled: true,
  });

  assert.deepEqual(result.items, { candy: 6 });
  assert.deepEqual(result.drops, { candy: 2 });
});

test('前台掉落余数跨多个后台心跳继续累计', () => {
  const gameData = data({ _f_candy: 0.75 });
  const state = { gameData, balls: {} };

  const first = settleBackgroundItems({
    state, from: 0, to: 1_000,
    itemRates: { candy: 0.5 },
    candyMultipliers: [{ mult: 1, weight: 1 }],
    enabled: true,
  });
  const second = settleBackgroundItems({
    state, from: 1_000, to: 2_000,
    itemRates: { candy: 0.5 },
    candyMultipliers: [{ mult: 1, weight: 1 }],
    enabled: true,
  });

  assert.deepEqual(first.drops, { candy: 1 });
  assert.deepEqual(second.drops, {});
  assert.equal(gameData.items.candy, 1);
  assert.equal(gameData._f_candy, 0.75);
});

test('随从 itemDrop 增益只在到期前的时间段生效', () => {
  const gameData = data({
    follower: { groups: ['itemdrop'], boost: 1, endsAt: 1_000 },
  });
  const result = settleBackgroundItems({
    state: { gameData, balls: {} },
    from: 0,
    to: 2_000,
    itemRates: { candy: 0.4 },
    candyMultipliers: [{ mult: 1, weight: 1 }],
    enabled: true,
  });

  assert.deepEqual(result.drops, { candy: 1 });
  assert.ok(Math.abs(gameData._f_candy - 0.2) < 1e-9);
});

test('非普通道路快照不推进余数或发放道具', () => {
  const gameData = data({ _f_candy: 0.5 });
  const result = settleBackgroundItems({
    state: { gameData, balls: {} },
    from: 0,
    to: 10_000,
    itemRates: { candy: 1 },
    enabled: false,
  });

  assert.deepEqual(result, { items: {}, drops: {} });
  assert.equal(gameData._f_candy, 0.5);
  assert.equal(gameData.items.candy, undefined);
});

test('非法余数和库存字段按零处理且后台日志按道具合并', () => {
  const gameData = data({
    _f_candy: Number.NaN,
    items: { candy: 'bad' },
    stats: { totalItemsEarned: { candy: -2 } },
    background: { stats: { items: { candy: 'bad' }, itemDrops: -1 } },
  });
  settleBackgroundItems({
    state: { gameData, balls: {} },
    from: 0,
    to: 2_000,
    itemRates: { candy: 1 },
    candyMultipliers: [{ mult: 2, weight: 1 }],
    enabled: true,
  });

  assert.equal(gameData.items.candy, 4);
  assert.equal(gameData.stats.totalItemsEarned.candy, 4);
  assert.equal(gameData.background.stats.items.candy, 4);
  assert.equal(gameData.background.stats.itemDrops, 2);
  assert.deepEqual(gameData.systemLogs, [{
    time: 2_000,
    type: 'item_gain',
    details: { item: 'candy', qty: 4, drops: 2, background: true },
  }]);
});

test('同一时间片先获得的精灵球可供随后遇敌消耗', () => {
  const gameData = data();
  const settled = settleBackgroundSlice({
    settledAt: 0,
    balls: {},
    gameData,
  }, {
    now: 1_000,
    encounterEveryMs: 1_000,
    resolveElapsed: ({ state, from, to }) => settleBackgroundItems({
      state,
      from,
      to,
      itemRates: { 'poke-ball': 1 },
      enabled: true,
    }),
    resolveEncounter: ({ state }) => state.balls['poke-ball'] > 0
      ? { result: 'caught', ball: 'poke-ball' }
      : { result: 'fled' },
  });

  assert.equal(settled.results[0].result, 'caught');
  assert.equal(settled.state.balls['poke-ball'], 0);
});

test('遇敌消耗精灵球后后续掉落不会把旧库存重新计入', () => {
  const gameData = data();
  const settled = settleBackgroundSlice({
    settledAt: 0,
    balls: {},
    gameData,
  }, {
    now: 2_000,
    encounterEveryMs: 1_000,
    resolveElapsed: ({ state, from, to }) => settleBackgroundItems({
      state,
      from,
      to,
      itemRates: { 'poke-ball': 1 },
      enabled: true,
    }),
    resolveEncounter: () => ({ result: 'caught', ball: 'poke-ball' }),
  });

  assert.equal(settled.state.balls['poke-ball'], 0);
  assert.equal(settled.state.gameData.items['poke-ball'], 1);
});

test('相同后台批次的同类道具日志合并为一条', () => {
  const gameData = data();
  const state = { gameData, balls: {} };
  const options = {
    state,
    itemRates: { candy: 1 },
    candyMultipliers: [{ mult: 1, weight: 1 }],
    enabled: true,
    logTime: 2_000,
  };

  settleBackgroundItems({ ...options, from: 0, to: 1_000 });
  settleBackgroundItems({ ...options, from: 1_000, to: 2_000 });

  assert.deepEqual(gameData.systemLogs, [{
    time: 2_000,
    type: 'item_gain',
    details: { item: 'candy', qty: 2, drops: 2, background: true },
  }]);
});
