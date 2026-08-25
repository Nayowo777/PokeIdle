import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadMetricsFunction() {
  const source = fs.readFileSync('src/ui.js', 'utf8');
  const match = source.match(/export function getScreenLayoutMetrics\(\)[\s\S]*?\n}\n/);
  assert.ok(match, 'ui.js 应导出 getScreenLayoutMetrics');
  const body = match[0].replace(/^export /, '');
  return body;
}

test('按 CSS transform 比例把物理矩形还原为 screen 内部坐标', () => {
  const context = {
    document: {
      querySelector(selector) {
        if (selector !== '#screen') return null;
        return {
          clientWidth: 400,
          clientHeight: 240,
          getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 480 }),
        };
      },
    },
  };
  context.$ = selector => context.document.querySelector(`#${selector}`);
  vm.runInNewContext(loadMetricsFunction(), context);
  const metrics = vm.runInNewContext('getScreenLayoutMetrics()', context);
  assert.equal(metrics.width, 400);
  assert.equal(metrics.height, 240);
  const rect = metrics.rect({ getBoundingClientRect: () => ({ left: 300, top: 170, width: 80, height: 40 }) });
  assert.equal(rect.left, 100);
  assert.equal(rect.top, 60);
  assert.equal(rect.width, 40);
  assert.equal(rect.height, 20);
});

test('无效 screen 布局返回 null，不产生零坐标', () => {
  const context = {
    document: {
      querySelector: () => ({
        clientWidth: 0,
        clientHeight: 0,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      }),
    },
  };
  context.$ = selector => context.document.querySelector(`#${selector}`);
  vm.runInNewContext(loadMetricsFunction(), context);
  assert.equal(vm.runInNewContext('getScreenLayoutMetrics()', context), null);
});

for (const file of ['src/items.js', 'src/battle.js', 'src/events.js', 'src/follower.js']) {
  test(`${file} 使用统一道路坐标辅助函数`, () => {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /getScreenLayoutMetrics/);
    assert.doesNotMatch(source, /screen\.getBoundingClientRect\(\)/);
  });
}

test('道路道具动画首帧使用逻辑布局宽度并继续运行', () => {
  const source = fs.readFileSync('src/items.js', 'utf8');
  const start = source.indexOf('export function spawnItemDrop');
  const end = source.indexOf('\n// ---------- 放入孵蛋器', start);
  assert.ok(start >= 0 && end > start, '应能提取 spawnItemDrop');

  const frames = [];
  const screen = { appendChild() {} };
  const character = { kind: 'character' };
  const roadLayer = { kind: 'road' };
  const idleView = { style: { display: '' } };
  const context = {
    phase: 'idle',
    _itemDropActive: false,
    ITEM_ICONS: { candy: 'candy.png' },
    ITEM_NAMES: { candy: '糖果' },
    document: {
      hidden: false,
      createElement: () => ({ style: {}, remove() {} }),
      querySelector: selector => selector === '.road-layer' ? roadLayer : null,
    },
    $: id => ({ screen, walkGif: character, idleView }[id] || null),
    getScreenLayoutMetrics: () => ({
      width: 274,
      rect: element => element === character
        ? { left: 24, top: 90, width: 24, height: 32 }
        : { left: 0, top: 120, width: 274, height: 80 },
    }),
    road: {
      isActive: () => true,
      getSpeed: () => 2,
      isBike: () => true,
      resume() {},
      pause() {},
      getPlace: () => '',
    },
    requestAnimationFrame: callback => { frames.push(callback); },
    rollCandyMult: () => 1,
    setItemDropActive() {},
    setIdleCharacter() {},
    grantItem() {},
    saveGame() {},
    showIdlePickup() {},
    performance: { now: () => 0 },
  };
  vm.runInNewContext(`let _dropEl = null; let _dropCancelCb = null;\n${source.slice(start, end).replace(/^export /, '')}`, context);

  assert.equal(vm.runInNewContext("spawnItemDrop('candy')", context), true);
  assert.equal(frames.length, 1);
  assert.doesNotThrow(() => frames.shift()(0));
  assert.equal(frames.length, 1);
});
