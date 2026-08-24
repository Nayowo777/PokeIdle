import test from 'node:test';
import assert from 'node:assert/strict';

import { backgroundCatchupSupported } from '../src/background-catchup.js';

test('浏览器后台补偿在 Android 原生壳中关闭以避免重复结算', () => {
  assert.equal(backgroundCatchupSupported({ isMobile: true }), false);
  assert.equal(backgroundCatchupSupported({ isMobile: false }), true);
  assert.equal(backgroundCatchupSupported(), true);
});
