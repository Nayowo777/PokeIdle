# Android 后台行走、导航与孵蛋路程实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 Android 后台挂机在普通步行状态下继续累计行走距离、推进导航并计算孵蛋器路程，同时保持遇敌、道具结算和事务回滚规则不变。

**架构：** 将 GPS 的像素消费从 UI 刷新中拆出纯数据推进函数；新增后台步行结算模块，在 `settleBackgroundSlice` 的时间段回调中统一更新总路程、导航和孵蛋状态。进入后台时保存步行快照，后台沿用该快照，不模拟骑行、钓鱼、特殊事件或道路场景切换。

**技术栈：** 原生 ES Modules、Node.js `node:test`、现有 `src/background-settlement.js` 时间片核心、现有 GPS 存档结构和 Capacitor Android 后台心跳。

---

### 任务 1：补充后台步行纯函数的失败测试

**文件：**
- 创建：`test/background-walk.test.mjs`
- 参考：`src/background-items.js`、`src/background-settlement.js`

- [ ] **步骤 1：编写失败测试**

覆盖以下真实行为：

```js
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
```

- [ ] **步骤 2：运行测试确认正确失败**

运行：`node --test test/background-walk.test.mjs`

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`，因为 `src/background-walk.js` 尚未创建。

### 任务 2：实现后台步行纯函数并通过单元测试

**文件：**
- 创建：`src/background-walk.js`
- 修改：`test/background-walk.test.mjs`

- [ ] **步骤 1：实现最小数据结算**

实现 `settleBackgroundWalk({ state, from, to })`：

```js
export function settleBackgroundWalk({ state, from, to } = {}) {
  const next = copyState(state);
  const enabled = next.walkingEnabled === true;
  const speed = finiteNonNegative(next.walkPxPerSecond);
  const elapsed = Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : 0;
  const distance = enabled ? (elapsed / 1000) * speed : 0;
  if (distance <= 0 || !next.gameData) return { state: next, distance: 0, hatched: 0 };
  next.gameData.stats ||= {};
  next.gameData.background ||= {};
  next.gameData.background.stats ||= {};
  next.gameData.stats.walkDistance = finiteNonNegative(next.gameData.stats.walkDistance) + distance;
  next.gameData.background.stats.walkDistance = finiteNonNegative(next.gameData.background.stats.walkDistance) + distance;
  return { state: next, distance, hatched: 0 };
}
```

`copyState` 必须深拷贝输入，不能修改调用方状态；非法数值归零。

- [ ] **步骤 2：运行测试确认通过**

运行：`node --test test/background-walk.test.mjs`

预期：2 个测试通过。

- [ ] **步骤 3：提交**

```bash
git add src/background-walk.js test/background-walk.test.mjs
git commit -m "feat(后台挂机): 增加步行路程纯数据结算"
```

### 任务 3：抽出 GPS 纯数据推进核心

**文件：**
- 修改：`src/gps.js`
- 创建：`test/gps-background-walk.test.mjs`

- [ ] **步骤 1：编写失败测试**

新增可测试的导出函数 `advanceGpsData(distance, gpsState)`，覆盖：

```js
test('GPS 纯数据推进可在单段内扣减剩余距离', () => {
  const gps = { curIdx: 2, destIdx: 1, path: [2, 1], seg: 0, totalPx: 1000, remainPx: 1000, units: 1, roamEnabled: false, massTarget: null, massArrived: false };
  const result = advanceGpsData(250, gps);
  assert.equal(result.consumed, 250);
  assert.equal(result.state.remainPx, 750);
  assert.equal(result.state.destIdx, 1);
});

test('GPS 纯数据推进可跨越多个路段并停止在普通目的地', () => {
  const gps = { curIdx: 2, destIdx: 3, path: [2, 1, 3], seg: 0, totalPx: 100, remainPx: 100, units: 1, roamEnabled: false, massTarget: null, massArrived: false };
  const result = advanceGpsData(250, gps);
  assert.equal(result.state.curIdx, 3);
  assert.equal(result.state.destIdx, null);
  assert.equal(result.state.path, null);
  assert.equal(result.consumed, 200);
});
```

测试必须先失败，因为当前 `gps.js` 只有绑定全局 `gameData` 和 UI 的 `gpsAddDistance()`。

- [ ] **步骤 2：实现纯数据函数**

把现有 `advanceSegment()` 中不依赖 DOM 的部分拆为 `advanceGpsData(distance, gpsState)`，使用当前距离矩阵和漫游规则；对每段设置最多 `DISTANCE_ADVANCE_GUARD = 1000` 次循环，遇到非法或零长度路段立即停止。函数返回 `{ state, consumed, reachedDestination, reachedEvent }`。

保留 `advanceSegment()` 作为前台包装：调用纯函数后同步 `gameData.gps`、处理骑行状态和 `render()`。`gpsAddDistance()` 改为调用纯函数，并继续调用 `updateGpsViewport()`。

- [ ] **步骤 3：运行 GPS 测试确认通过**

运行：`node --test test/gps-background-walk.test.mjs`

预期：2 个测试通过；现有 GPS 相关测试继续通过。

- [ ] **步骤 4：提交**

```bash
git add src/gps.js test/gps-background-walk.test.mjs
git commit -m "refactor(GPS): 拆分后台可复用的路段推进"
```

### 任务 4：提取孵蛋器达标检查并补充失败测试

**文件：**
- 创建：`src/incubator-progress.js`
- 创建：`test/incubator-progress.test.mjs`
- 修改：`src/main.js`、`src/ui.js`

- [ ] **步骤 1：编写失败测试**

```js
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
```

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test test/incubator-progress.test.mjs`

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`，因为纯函数尚未创建。

- [ ] **步骤 3：实现纯函数并替换前台重复逻辑**

实现 `settleIncubatorProgress(gameData, { walkDistance, hatchMultiplier })`，复制存档后按现有规则检查所有槽位：`used + 100 >= need` 时设置 `hatched = true`。函数不更新 DOM、不生成宝可梦、不增加 `totalEggsHatched`。

`main.js` 的前台 Tick 和 `ui.js` 的计时刷新都改为调用该函数或共享的 `isIncubatorReady()`，保留现有红点和页面渲染。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --test test/incubator-progress.test.mjs`

预期：2 个测试通过。

- [ ] **步骤 5：提交**

```bash
git add src/incubator-progress.js src/main.js src/ui.js test/incubator-progress.test.mjs
git commit -m "feat(孵蛋): 抽取可复用的路程达标检查"
```

### 任务 5：接入后台时间片、快照和事务

**文件：**
- 修改：`src/state.js`
- 修改：`src/main.js`
- 修改：`src/battle.js`
- 修改：`src/views.js`
- 修改：`test/background-battle.test.mjs`
- 修改：`test/background-settlement.test.mjs`

- [ ] **步骤 1：先写集成失败测试**

增加测试场景：

```js
test('后台时间片同步累计步行、GPS 和孵蛋器', async () => {
  // 构造 walkingEnabled=true、walkPxPerSecond=30、60 秒后台时间片；
  // 断言 stats.walkDistance 增加 1800、background.stats.walkDistance 增加 1800、
  // GPS remainPx 减少 1800，并将达到阈值的 incubator.hatched 设为 true。
});

test('进入后台快照只允许普通步行状态', () => {
  // idle + 普通步行 => walkingEnabled=true；
  // 骑行、钓鱼、事件区域、过渡或战斗 => walkingEnabled=false。
});
```

测试必须先失败，证明现有后台结算不会更新这些字段。

- [ ] **步骤 2：补齐状态默认值和进入后台快照**

在 `normalizeBackgroundState()` 和 `getDefaultSave()` 增加 `walkingEnabled`、`walkPxPerSecond`、`stats.walkDistance`。

`window.__POKEIDLE_BACKGROUND_ENTER__` 在现有普通道路判定之外记录：

```js
gameData.background.walkingEnabled = gameData.background.roadItemsEnabled;
gameData.background.walkPxPerSecond = gameData.background.walkingEnabled
  ? Math.max(0, road.getSpeed() * 60)
  : 0;
```

进入后台时同时重置 `settledAt` 和 `encounterRemainderMs`，保存失败继续沿用现有错误处理。

- [ ] **步骤 3：把步行结算接入 `resolveElapsed`**

在 `battle.js` 的 `resolveElapsed` 中先调用 `settleBackgroundWalk`，再调用 `settleBackgroundItems`，最后把纯 GPS 状态写回 `gameData.gps` 并结算孵蛋器。后台状态使用深拷贝，不调用 `render()`。

每个时间段传入快照速度；当步行快照为 false 时，后台仍按现有遇敌规则工作，但不增加路程、GPS 或孵蛋进度。

- [ ] **步骤 4：处理导航和孵蛋边界**

普通目的地到达后停止 GPS，漫游到达节点后继续消费剩余像素；无导航时只增加总路程和孵蛋进度。事件点和损坏路线按规格停止并保留已消费路程。

若出现 `pendingEncounter`，继续保持现有逻辑：不推进该暂停点之后的时间片。

- [ ] **步骤 5：运行集成测试确认通过**

运行：`node --test test/background-battle.test.mjs test/background-settlement.test.mjs test/background-walk.test.mjs test/gps-background-walk.test.mjs test/incubator-progress.test.mjs`

预期：全部通过，且既有捕获、道具、暂停和回滚断言不变。

- [ ] **步骤 6：提交**

```bash
git add src/state.js src/main.js src/battle.js src/views.js test/background-battle.test.mjs test/background-settlement.test.mjs
git commit -m "fix(后台挂机): 同步导航路程与孵蛋进度"
```

### 任务 6：移动端回归、构建和文档

**文件：**
- 修改：`src/views.js`
- 修改：`README.md`
- 修改：`update_log.md`
- 修改：`test/mobile-background-settings.test.mjs`
- 修改：`test/mobile-build-web.test.mjs`

- [ ] **步骤 1：更新设置说明和契约测试**

将后台挂机提示改为“后台继续普通道路行走、导航、孵蛋、道具和自动捕获”，并断言 `walkingEnabled` 与 `walkPxPerSecond` 被写入进入后台快照。

- [ ] **步骤 2：运行完整验证**

运行：

```bash
node --test test/*.test.mjs
npm run test:mobile
npm run android:prepare
git diff --check
```

预期：全部测试通过，Android Web 资源同步成功，差异检查无输出。

- [ ] **步骤 3：提交**

```bash
git add src/views.js README.md update_log.md test/mobile-background-settings.test.mjs test/mobile-build-web.test.mjs
git commit -m "docs(Android): 更新后台挂机行走与孵蛋说明"
```

### 任务 7：正式 APK 验证

**文件：**
- 修改：`package.json`（版本号递增 1 个 patch）
- 修改：`src-tauri/Cargo.toml`
- 修改：`src-tauri/tauri.conf.json`

- [ ] **步骤 1：递增版本并构建**

更新 Android/桌面版本到 `1.1.1`，运行：

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
npm run android:build
```

- [ ] **步骤 2：验证 APK**

运行：

```bash
cd dist/android
shasum -a 256 -c pokeidle-android-v1.1.1.apk.sha256
/Users/nayo/Library/Android/sdk/build-tools/35.0.0/apksigner verify --verbose --print-certs pokeidle-android-v1.1.1.apk
```

预期：校验和为 `OK`，V2/V3 签名均为 `true`。

- [ ] **步骤 3：提交最终变更**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore(Android): 发布后台路程版本 1.1.1"
```

