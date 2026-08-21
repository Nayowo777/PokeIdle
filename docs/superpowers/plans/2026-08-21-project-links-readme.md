# 项目地址与 README 更新实现计划

> **面向 AI 代理的工作者：** 使用当前会话内联执行此计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 在设置页展示原项目与 Android 分支地址，并更新 README 的项目关系与 Android 使用说明。

**架构：** 复用设置页现有外部链接样式和点击处理，只增加一个独立链接节点；README 只补充当前分支的定位和构建信息，不重写原项目玩法说明。静态契约测试验证链接常量、文本和外部链接安全属性。

**技术栈：** 原生 ES modules、Node.js `node:test`、Markdown。

---

### 任务 1：锁定链接契约

**文件：**
- 创建：`test/project-links-contract.test.mjs`

- [ ] **步骤 1：编写失败测试**

测试设置页必须包含原项目和 Android 分支两个链接，README 必须说明分支关系和构建命令。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test test/project-links-contract.test.mjs`

预期：失败，因为设置页当前只有原项目链接，README 没有分支说明。

### 任务 2：实现设置页双链接

**文件：**
- 修改：`src/views.js:1099-1103,1294-1298`
- 修改：`src/styles.css:3984-4002`（仅在需要时保持现有样式）

- [ ] **步骤 1：新增 Android 分支链接**

新增独立的 `androidBranchLink` 节点，使用 `https://github.com/Nayowo777/PokeIdle/tree/feature/save-transfer`、`target="_blank"` 和 `rel="noopener"`；点击处理调用 `window.__POKEIDLE_MOBILE__?.openExternal`，否则使用 `window.open`。

- [ ] **步骤 2：运行契约测试确认通过**

运行：`node --test test/project-links-contract.test.mjs`

预期：通过。

### 任务 3：更新 README

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：补充项目关系和 Android 分支说明**

在项目简介后增加原项目与当前 Android 分支链接；在 Android 正式版章节补充分支地址、后台挂机、存档迁移、手机 UI 和 APK 输出说明。

- [ ] **步骤 2：运行契约测试确认 README 通过**

运行：`node --test test/project-links-contract.test.mjs`

预期：通过。

### 任务 4：完整验证

- [ ] **步骤 1：运行测试**

运行：`node --test test/*.test.mjs` 和 `npm run test:mobile`。

- [ ] **步骤 2：同步移动端资源**

运行：`npm run android:prepare`。

- [ ] **步骤 3：检查差异**

运行：`git diff --check`。
