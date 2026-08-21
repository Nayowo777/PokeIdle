# Android 原生存档传输实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 使用 Android 原生 SAF 和应用私有文件 I/O 替换容易在 MIUI/HyperOS 上挂起的存档导入、导出与持久化链路。

**架构：** 新增单一职责的 Capacitor 原生插件 `PokeIdleSavePlugin`，负责系统文件选择、系统文件保存和应用私有存档的原子读写。JavaScript 移动桥接只负责排队和协议适配，存档控制器继续负责解析、确认、回滚与刷新。

**技术栈：** Java、Android Storage Access Framework、Capacitor 7 插件 API、ES Modules、Node.js 内置测试运行器。

---

## 文件结构

- 创建 `android/app/src/main/java/com/pokemon/idle/PokeIdleSavePlugin.java`：Android SAF 与应用私有存档读写。
- 修改 `android/app/src/main/java/com/pokemon/idle/MainActivity.java`：注册新插件。
- 修改 `mobile/bridge-source.js`：将移动端存档接口切换到新原生插件并保留保存队列。
- 修改 `src/save-platform.js`：Android 导入优先调用移动桥接。
- 修改 `src/save-transfer-controller.js`：报告导入、导出阶段并补充稳定错误映射。
- 修改 `src/views.js`：在设置页呈现操作阶段。
- 修改 `test/mobile-save-native-contract.test.mjs`：验证原生插件和 SAF 契约。
- 修改 `test/mobile-save-platform.test.mjs`：验证 Android 原生导入优先级。
- 修改 `test/mobile-save-transaction.test.mjs`：验证阶段反馈、取消和刷新。
- 修改 `test/mobile-save-feedback-contract.test.mjs`：验证设置页接入阶段反馈。

### 任务 1：定义 JavaScript 原生桥接契约

- [ ] **步骤 1：编写失败的移动桥接测试**

在 `test/mobile-save-native-contract.test.mjs` 中断言：

```js
assert.match(bridgeSource, /registerPlugin\(['"]PokeIdleSave['"]\)/);
assert.match(bridgeSource, /pickImportFile/);
assert.doesNotMatch(bridgeSource, /Share\.share/);
```

在 `test/mobile-save-platform.test.mjs` 中构造同时含 `mobile.pickImportFile` 和浏览器 document 的平台，断言移动方法返回值被直接使用。

- [ ] **步骤 2：运行测试并确认因缺少原生桥接而失败**

运行：

```bash
node --test test/mobile-save-native-contract.test.mjs test/mobile-save-platform.test.mjs
```

预期：FAIL，指出未注册 `PokeIdleSave` 或未调用 `mobile.pickImportFile`。

- [ ] **步骤 3：实现最小 JavaScript 桥接**

在 `mobile/bridge-source.js` 中使用：

```js
import { registerPlugin } from '@capacitor/core';
const NativeSave = registerPlugin('PokeIdleSave');
```

将 `loadGameData`、`saveGameData`、`pickImportFile`、`exportSaveData`、`createImportBackup`、`loadImportBackup` 映射到 `NativeSave`，保存调用仍通过 `saveQueue` 串行化。

在 `src/save-platform.js` 的 `pickImportFile()` 中，先判断：

```js
if (mobile?.pickImportFile) return await mobile.pickImportFile();
```

- [ ] **步骤 4：运行测试确认通过**

运行同一步骤 2，预期 PASS。

### 任务 2：实现 Android 原生存档插件

- [ ] **步骤 1：扩展失败的原生契约测试**

读取 `PokeIdleSavePlugin.java` 和 `MainActivity.java`，断言包含：

```js
assert.match(plugin, /@CapacitorPlugin\(name = "PokeIdleSave"\)/);
assert.match(plugin, /Intent\.ACTION_OPEN_DOCUMENT/);
assert.match(plugin, /Intent\.ACTION_CREATE_DOCUMENT/);
assert.match(plugin, /SAVE_MAX_BYTES\s*=\s*20L\s*\*\s*1024L\s*\*\s*1024L/);
assert.match(plugin, /getFilesDir\(\)/);
assert.match(plugin, /save\.json\.tmp/);
assert.match(activity, /registerPlugin\(PokeIdleSavePlugin\.class\)/);
```

- [ ] **步骤 2：运行测试并确认新插件缺失**

运行：

```bash
node --test test/mobile-save-native-contract.test.mjs
```

预期：FAIL，文件不存在或契约断言失败。

- [ ] **步骤 3：创建插件并注册**

实现以下插件方法：

```java
@PluginMethod public void loadGameData(PluginCall call)
@PluginMethod public void saveGameData(PluginCall call)
@PluginMethod public void pickImportFile(PluginCall call)
@PluginMethod public void exportSaveData(PluginCall call)
@PluginMethod public void createImportBackup(PluginCall call)
@PluginMethod public void loadImportBackup(PluginCall call)
```

使用 `@ActivityCallback` 接收 SAF 结果；用户取消时 `call.resolve()`。读取导入文件时逐块累计，超过 20 MB 后以 `SAVE_TOO_LARGE` 拒绝。私有文件写入使用 `save.json.tmp`，成功写完后替换目标文件；写主存档前将当前文件复制到 `save.json.bak`。

- [ ] **步骤 4：编译 Java 并运行契约测试**

运行：

```bash
node --test test/mobile-save-native-contract.test.mjs
./android/gradlew -p android compileDebugJavaWithJavac
```

预期：测试 PASS，Java 编译成功。

### 任务 3：增加操作阶段反馈与错误映射

- [ ] **步骤 1：编写失败的控制器测试**

在 `test/mobile-save-transaction.test.mjs` 中注入 `showProgress`，验证导入成功依次包含：

```js
['正在读取存档', '正在备份当前存档', '正在写入新存档']
```

验证导出先显示 `请选择存档保存位置`，原生取消时不显示错误；验证 `IMPORT_READ_FAILED`、`EXPORT_WRITE_FAILED` 和 `INVALID_FILE_URI` 映射为稳定中文提示。

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
node --test test/mobile-save-transaction.test.mjs
```

预期：FAIL，缺少 `showProgress` 或错误映射。

- [ ] **步骤 3：实现阶段回调和提示**

给 `createSaveTransferController` 增加：

```js
showProgress = () => {}
```

在导入、导出对应步骤调用该回调。`src/views.js` 将 `showProgress` 映射到 `#saveTransferStatus`，只显示中性忙碌状态，不写系统消息框。

扩展 `formatSaveTransferError`：

```js
IMPORT_READ_FAILED -> 存档读取失败，请重新选择文件
INVALID_FILE_URI -> 无法读取所选存档文件
EXPORT_WRITE_FAILED -> 存档导出失败，请更换保存位置
```

- [ ] **步骤 4：运行相关测试确认通过**

运行：

```bash
node --test test/mobile-save-transaction.test.mjs test/mobile-save-feedback-contract.test.mjs
```

预期：PASS。

### 任务 4：回归验证和 Android 同步

- [ ] **步骤 1：运行所有 Node 测试**

运行：

```bash
node --test test/*.test.mjs
npm run test:mobile
```

预期：全部 PASS。

- [ ] **步骤 2：检查格式与工作区边界**

运行：

```bash
git diff --check
git status --short
```

预期：无空白错误；不纳入用户已有的 `.superpowers/` 目录与其未授权改动。

- [ ] **步骤 3：同步 Android 项目**

运行：

```bash
env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
PATH=/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/bin:/usr/local/bin:/Users/nayo/.nvm/versions/node/v25.5.0/bin:/usr/bin:/bin:/usr/sbin:/sbin \
npm run android:prepare
```

预期：Web 资源构建和 Capacitor Android 同步成功。

- [ ] **步骤 4：最终检查**

检查 `git diff`，确认没有恢复或覆盖用户已有修改，记录真机仍需验证的红米导入和导出步骤。
