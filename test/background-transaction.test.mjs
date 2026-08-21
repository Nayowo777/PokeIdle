import test from 'node:test';
import assert from 'node:assert/strict';

import { commitBackgroundState } from '../src/background-transaction.js';

test('候选存档失败后恢复内存并补偿写回原存档', async () => {
  const original = { items: { candy: 1 }, stats: { lastSaveTime: 10 } };
  const candidate = { items: { candy: 9 }, stats: { lastSaveTime: 20 } };
  let active = original;
  const saves = [];

  await assert.rejects(() => commitBackgroundState({
    originalData: original,
    nextData: candidate,
    requiredSource: 'mobile',
    setData: value => { active = value; },
    save: async options => {
      saves.push({ candy: active.items.candy, options });
      if (active === candidate) throw new Error('mobile failed');
    },
  }), /mobile failed/);

  assert.equal(active, original);
  assert.deepEqual(saves, [
    { candy: 9, options: { strict: true, requiredSource: 'mobile' } },
    { candy: 1, options: { strict: true, preserveTimestamp: true, requiredSource: 'mobile' } },
  ]);
});

test('补偿写回失败会附加到原始保存错误', async () => {
  const original = { items: {} };
  const candidate = { items: { candy: 1 } };
  let active = original;
  let calls = 0;

  await assert.rejects(() => commitBackgroundState({
    originalData: original,
    nextData: candidate,
    setData: value => { active = value; },
    save: async () => {
      calls += 1;
      if (calls === 1) throw new Error('candidate failed');
      throw new Error('rollback failed');
    },
  }), error => {
    assert.equal(error.message, 'candidate failed');
    assert.equal(error.rollbackError?.message, 'rollback failed');
    return true;
  });

  assert.equal(active, original);
});
