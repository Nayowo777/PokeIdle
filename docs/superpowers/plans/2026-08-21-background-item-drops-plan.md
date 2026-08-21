# Android 后台道路道具结算实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Android 后台挂机按普通道路规则持续获得糖果、精灵球等全部道路道具，并保证随从增益、余数、暂停点和重复心跳结算正确。

**架构：** 扩展 `settleBackgroundSlice()`，在每次遇敌前及尾段调用纯时间段回调；新增纯数据道路道具结算模块，复用 `_f_<item>` 余数和现有配置。Android 进入后台时保存普通道路快照，后台入口在同一存档副本中按时间顺序处理道具和遇敌，最后严格保存一次。

**技术栈：** JavaScript ES Modules、Node.js 内置测试运行器、Capacitor Android、现有存档模型。

---

## 文件结构

- 创建 `src/background-items.js`：纯数据道路道具结算、糖果倍率、随从有效期分段和后台日志。
- 创建 `test/background-items.test.mjs`：覆盖道具数量、糖果倍率、余数、随从、非法值和禁用快照。
- 修改 `src/background-settlement.js`：增加 `resolveElapsed` 时间段回调，保证暂停点和尾段正确。
- 修改 `test/background-settlement.test.mjs`：验证时间段顺序、暂停截断、重复时间戳和 24 小时边界。
- 修改 `src/battle.js`：把道路道具结算接入现有后台队列，并同步新获得或消耗的球库存。
- 修改 `src/state.js`：兼容 `roadItemsEnabled`、后台道具统计和旧存档。
- 修改 `src/main.js`：进入后台时记录普通道路快照。
- 修改 `test/background-battle.test.mjs`、`test/mobile-background-contract.test.mjs`：验证集成顺序和 Android 生命周期契约。
- 修改 `package.json`、`package-lock.json`、`android/app/build.gradle`、`README.md`：版本递增至 `1.0.14` 并更新 APK 文件名。

### 任务 1：扩展后台时间片核心

**文件：**
- 修改：`src/background-settlement.js`
- 测试：`test/background-settlement.test.mjs`

- [ ] **步骤 1：编写失败测试**

新增测试，要求 `resolveElapsed` 按以下顺序接收时间段：

```js
test('每次遇敌前和尾段按时间顺序结算经过时间', () => {
  const spans = [];
  const events = [];
  const result = settleBackgroundSlice({ settledAt: 0, balls: {}, stats: {} }, {
    now: 2_500,
    encounterEveryMs: 1_000,
    resolveElapsed: ({ from, to }) => spans.push([from, to]),
    resolveEncounter: ({ at }) => events.push(at) || { result: 'fled' },
  });
  assert.deepEqual(spans, [[0, 1_000], [1_000, 2_000], [2_000, 2_500]]);
  assert.deepEqual(events, [1_000, 2_000]);
  assert.equal(result.state.settledAt, 2_500);
});
```

再增加暂停测试，要求暂停后没有尾段回调。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/background-settlement.test.mjs`

预期：FAIL，`spans` 为空，证明时间段回调尚未实现。

- [ ] **步骤 3：编写最少实现**

在 `settleBackgroundSlice()` 内维护 `elapsedCursor`：每次 `resolveEncounter()` 前调用 `options.resolveElapsed?.({ state: nextState, from: elapsedCursor, to: at })`，然后推进游标；无暂停时在循环后结算到 `now`，暂停时停在 `pausedAt`。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/background-settlement.test.mjs`

预期：该文件全部通过。

- [ ] **步骤 5：提交**

```bash
git add src/background-settlement.js test/background-settlement.test.mjs
git commit -m "feat(后台挂机): 增加时间段结算回调"
```

### 任务 2：实现纯道路道具结算

**文件：**
- 创建：`src/background-items.js`
- 创建：`test/background-items.test.mjs`

- [ ] **步骤 1：编写失败测试**

测试公开接口：

```js
const result = settleBackgroundItems({
  state: { gameData },
  from: 0,
  to: 2_000,
  itemRates: { candy: 0.5, 'poke-ball': 0.5 },
  candyMultipliers: [{ mult: 2, weight: 1 }],
  random: () => 0,
  enabled: true,
});
assert.deepEqual(result.items, { candy: 2, 'poke-ball': 1 });
assert.equal(gameData.items.candy, 2);
assert.equal(gameData.stats.totalItemsEarned.candy, 2);
```

补充测试：跨心跳余数、每次糖果掉落独立抽倍率、随从中途到期、禁用快照、非法字段归一化、球库存与 `state.balls` 同步。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/background-items.test.mjs`

预期：FAIL，模块不存在。

- [ ] **步骤 3：编写最少实现**

实现：

```js
export function settleBackgroundItems({
  state, from, to, itemRates = ITEM_RATES,
  candyMultipliers = CANDY_DROP_MULT,
  random = Math.random, enabled = true,
})
```

函数只修改传入的后台状态副本，不访问 DOM；按随从 `endsAt` 将时间分为增益段和普通段，更新 `_f_<item>`、库存、`totalItemsEarned`、后台统计和合并日志。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/background-items.test.mjs`

预期：全部通过。

- [ ] **步骤 5：提交**

```bash
git add src/background-items.js test/background-items.test.mjs
git commit -m "feat(后台挂机): 结算普通道路道具"
```

### 任务 3：接入存档与 Android 生命周期

**文件：**
- 修改：`src/battle.js`
- 修改：`src/state.js`
- 修改：`src/main.js`
- 修改：`test/background-battle.test.mjs`
- 修改：`test/mobile-background-contract.test.mjs`

- [ ] **步骤 1：编写失败测试**

增加契约和集成测试：

```js
test('后台时间片先结算道路道具再处理随后遇敌', () => {
  // 初始无球，时间段产生 1 个精灵球，随后遇敌应能消耗并捕获。
});

test('后台状态兼容道路快照和道具统计', () => {
  const state = normalizeBackgroundState({
    roadItemsEnabled: true,
    stats: { items: { candy: 3 }, itemDrops: 2 },
  }, 1_000);
  assert.equal(state.roadItemsEnabled, true);
  assert.deepEqual(state.stats.items, { candy: 3 });
  assert.equal(state.stats.itemDrops, 2);
});
```

契约测试要求 `__POKEIDLE_BACKGROUND_ENTER__` 设置 `roadItemsEnabled`，并排除骑行、钓鱼、特殊事件和自行车过渡。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/background-battle.test.mjs test/mobile-background-contract.test.mjs`

预期：FAIL，缺少快照和道路结算接入。

- [ ] **步骤 3：编写最少实现**

- 在 `state.js` 归一化新增字段和嵌套统计。
- 在 `main.js` 进入后台时计算并保存普通道路快照。
- 在 `battle.js` 将 `settleBackgroundItems()` 传给 `resolveElapsed`；道路掉落产生的球写入 `state.balls`，随后遇敌可以使用。
- 保存成功后刷新内存，失败时恢复原存档。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/background-battle.test.mjs test/mobile-background-contract.test.mjs test/background-items.test.mjs test/background-settlement.test.mjs`

预期：全部通过。

- [ ] **步骤 5：提交**

```bash
git add src/battle.js src/state.js src/main.js test/background-battle.test.mjs test/mobile-background-contract.test.mjs
git commit -m "feat(Android): 接入后台道路道具挂机"
```

### 任务 4：版本、回归测试与发布准备

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`android/app/build.gradle`
- 修改：`README.md`

- [ ] **步骤 1：更新版本**

将版本更新为：

```text
package.json/package-lock.json: 1.0.14
versionCode: 10014
versionName: 1.0.14
README APK: pokeidle-android-v1.0.14.apk
```

- [ ] **步骤 2：运行完整验证**

运行：

```bash
node --test test/*.test.mjs
npm run test:mobile
npm run android:prepare
git diff --check
```

预期：全部命令退出码为 0，无失败测试。

- [ ] **步骤 3：提交**

```bash
git add package.json package-lock.json android/app/build.gradle README.md
git commit -m "chore(Android): 发布 1.0.14 后台道具版本"
```

- [ ] **步骤 4：检查工作树边界**

运行：`git status --short --branch`

预期：只剩用户原有的 `src/save-platform.js` 和 `.superpowers/` 未提交改动。
