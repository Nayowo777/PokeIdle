# Android 共享目录存档与兼容性优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 合并 fork 最新修复，并让 Android 可通过共享目录替换固定存档文件完成安全导入，同时修复导入后导出闪退。

**架构：** Android 原生插件负责 SAF 目录授权、共享文档读写和私有存档 I/O；JavaScript 平台层提供统一接口，控制器使用串行操作队列执行导入和导出。应用启动及回到前台时检查共享存档候选，但始终由用户确认后才覆盖当前存档。

**技术栈：** Java 17/21、Android Storage Access Framework、Capacitor 7、原生 ES Modules、Node.js test runner、Gradle 8。

---

## 文件结构

- 修改 `android/app/src/main/java/com/pokemon/idle/PokeIdleSavePlugin.java`：共享目录授权、文档读写、错误稳定化和回调保护。
- 修改 `mobile/bridge-source.js`：共享目录 bridge 和前台候选检测事件。
- 修改 `src/save-platform.js`：跨平台共享目录能力探测和调用。
- 修改 `src/save-transfer-controller.js`：导入导出串行化和共享候选导入。
- 修改 `src/views.js`：设置页共享目录入口、状态和检测绑定。
- 修改 `src/main.js`：启动和前台恢复时触发共享候选检查。
- 修改 `src/index.html`、`src/styles.css`：共享目录确认与状态界面。
- 修改 `test/mobile-save-native-contract.test.mjs`：Android 原生 SAF 契约。
- 修改 `test/mobile-save-platform.test.mjs`：平台 API 行为。
- 修改 `test/mobile-save-transaction.test.mjs`：串行事务和共享候选导入。
- 修改 `test/mobile-save-feedback-contract.test.mjs`：UI 和前台检测契约。

### 任务 1：保存当前发布配置并合并 fork

- [ ] 运行 `node --test test/mobile-android-utils.test.mjs`，确认 Android 版本读取测试通过。
- [ ] 提交 1.1.1 版本和 Gradle 版本同步改动，不包含 `.superpowers/`。
- [ ] 合并 `upstream/main`，冲突时保留 Android 增强文件和后台结算，实现层吸收 upstream 的玩法与图鉴修复。
- [ ] 运行 `node --test test/*.test.mjs`，记录合并后的基线结果。

### 任务 2：用失败测试定义共享目录契约

- [ ] 在 `test/mobile-save-native-contract.test.mjs` 断言原生插件使用 `ACTION_OPEN_DOCUMENT_TREE`、`takePersistableUriPermission`、持久化目录 URI、固定文件名和稳定错误码。
- [ ] 在 `test/mobile-save-platform.test.mjs` 定义 `selectSharedSaveDirectory`、`readSharedSaveCandidate` 和 `writeSharedSaveData` 的移动端优先行为。
- [ ] 在 `test/mobile-save-transaction.test.mjs` 定义导入后立即导出严格串行，以及共享候选复用备份导入事务。
- [ ] 运行上述测试并确认因功能缺失而失败。

### 任务 3：实现 Android 共享目录 I/O

- [ ] 为 `PokeIdleSavePlugin` 增加目录选择 Activity 回调并保存持久 URI 权限。
- [ ] 增加固定文档查询、20 MB 限制读取、修改标识返回和权限失效清理。
- [ ] 增加临时文档写入、备份旧文档、替换目标文档和失败回滚。
- [ ] 用 `AtomicBoolean` 或等价一次性完成辅助方法保护所有异步调用。
- [ ] 运行原生契约测试并确认通过。

### 任务 4：实现平台接口与串行事务

- [ ] 在移动 bridge 暴露共享目录 API，并统一把取消操作映射为 `null`。
- [ ] 在 `createSavePlatform` 转发共享目录 API，并让非 Android 平台返回不支持状态。
- [ ] 在存档控制器中添加单一 Promise 操作队列；导入、导出、恢复和共享候选导入都通过队列执行。
- [ ] 导出成功后写入固定共享文件；共享写入失败时保留手动 SAF 导出能力并显示明确提示。
- [ ] 运行平台和事务测试并确认通过。

### 任务 5：接入设置页与前台检测

- [ ] 在设置页增加“选择共享存档目录”“检查外置存档”按钮和当前状态说明。
- [ ] 启动及 Android 回到前台时读取共享候选；修改标识未变化时不重复提示。
- [ ] 使用现有覆盖确认框展示外置存档摘要，确认后执行备份导入事务。
- [ ] 为共享目录未授权、权限失效、文件不存在和无效存档提供稳定中文提示。
- [ ] 运行反馈/UI 契约测试并确认通过。

### 任务 6：完整验证与发布构建

- [ ] 运行 `node --test test/*.test.mjs`。
- [ ] 运行 `npm run test:mobile`。
- [ ] 运行 `npm run android:prepare`。
- [ ] 运行 `git diff --check`。
- [ ] 提交共享目录与兼容性优化改动。
- [ ] 使用 JDK 21 运行 `npm run android:build`，校验 APK 内部版本、SHA-256 和 V2/V3 正式签名。
