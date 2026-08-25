# Android 共享目录存档与兼容性优化设计

## 背景

当前 Android 存档导入和导出主要依赖系统文件选择器。部分设备，尤其是红米设备，在导入存档后立即导出时会因为 URI 生命周期、Activity 回调重复或输出流异常导致闪退。用户还希望可以通过替换共享目录中的存档文件完成导入。

## 目标

- 合并 `upstream/main` 的最新 fork 更新，同时保留本分支的 Android 后台、SAF 存档和路程结算能力。
- 支持用户在 `Download/PokeIdle/` 共享目录中替换固定存档文件后导入。
- 修复导入后立即导出、取消选择、URI 失效和重复回调导致的闪退。
- 保持 Web、Tauri 和 Android 的现有导入导出接口兼容。
- 让导入、导出和共享目录同步具备串行执行、原子写入和可恢复错误提示。

## 非目标

- 不申请 `MANAGE_EXTERNAL_STORAGE`、`READ_EXTERNAL_STORAGE` 或 `WRITE_EXTERNAL_STORAGE`。
- 不自动覆盖当前游戏存档；共享目录文件只触发待确认的导入提示。
- 不改变存档 JSON 格式、版本校验规则和导入前备份策略。

## 架构

### Android 原生插件

`PokeIdleSavePlugin` 继续负责私有主存档和导入前备份，并新增共享目录管理：

- 首次调用共享目录功能时使用 `ACTION_OPEN_DOCUMENT_TREE` 选择目录。
- 通过 `takePersistableUriPermission` 保存目录 URI，写入 `SharedPreferences`。
- 固定文件名为 `pokeidle-save.json`，共享目录内另维护 `pokeidle-save.json.bak` 和临时文件。
- 读取共享文件限制为 20 MB，并返回文件名、内容、字节数和文件修改标识。
- 导出到共享目录时使用独立临时文档，写完并同步后替换目标文档；系统文件选择器导出仍使用独立 `ACTION_CREATE_DOCUMENT` 回调。
- 每个 Activity 回调和后台 I/O 任务均通过一次性完成保护，确保只调用一次 `resolve` 或 `reject`。

### JavaScript bridge 与平台层

`mobile/bridge-source.js` 暴露共享目录方法，并对原生插件异常做稳定化处理。`src/save-platform.js` 增加共享目录读写和目录选择的可选能力，桌面端和浏览器维持现有实现。

导入导出操作由现有 `createSaveTransferController` 串行调用。导入成功后等待持久化完成，再允许下一次导出；任何失败都转换为稳定错误码，不让异常未处理地传播到 WebView。

### 共享文件检测

启动和 Android 回到前台时调用共享目录检查。若固定文件存在且其修改标识不同于上次已处理值，则只显示“发现共享目录存档”的确认入口。用户确认后复用当前导入事务；取消或校验失败时记录提示并保留当前存档。

## 数据流

1. 用户点击“导出存档”，应用先保存当前状态并生成带元数据的 JSON。
2. 原生插件将 JSON 写入共享目录临时文件，完成后替换 `pokeidle-save.json`；如果用户选择了其他位置，再单独写入 SAF URI。
3. 用户用文件管理器替换 `Download/PokeIdle/pokeidle-save.json`。
4. 应用启动或回到前台检查文件修改标识，读取并返回候选存档。
5. 用户确认后执行保存当前存档、创建私有备份、校验并应用导入、持久化和刷新。

## 错误处理

- 用户取消目录或文件选择：返回 `null`，不显示错误。
- 目录权限丢失：返回 `SHARED_SAVE_ACCESS_FAILED`，提示重新选择目录。
- URI 为 `null`、输出流为空或重复回调：返回稳定错误，不抛出到 WebView。
- 文件超过 20 MB、JSON 无效或版本不兼容：沿用现有导入错误码。
- 写入失败：保留当前存档，尝试恢复导入前备份，并显示可操作提示。
- 导入后立即导出：由共享的 Promise 队列和原生单线程 I/O 队列保证顺序。

## 测试策略

- JavaScript 单元测试：共享目录平台 API、取消和异常映射、导入后立即导出的串行行为。
- 原生契约测试：目录选择、持久化 URI 权限、临时文件原子替换、一次性回调保护、错误码和无公共存储权限。
- 完整回归：`node --test test/*.test.mjs`、`npm run test:mobile`、`npm run android:prepare` 和正式 APK 构建。
