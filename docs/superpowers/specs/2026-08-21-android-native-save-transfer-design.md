# Android 原生存档传输兼容设计

## 背景

部分红米设备运行 MIUI 或 HyperOS 时，现有 Android 存档传输链路会无期限等待：

- 导入文件能够完成选择和预览，但确认覆盖后不刷新，存档也不变化。
- 点击导出后，系统分享面板完全不出现。
- 同一 APK 在其他品牌手机上工作正常。

当前 Android 导入依赖 WebView 的文件输入框，导出依赖 Capacitor Share，主存档与导入前备份依赖 Capacitor Filesystem。成功路径和失败路径都会返回结果，只有原生异步调用没有回调时，界面才会一直没有后续反馈。因此，本次修复需要避开受厂商实现影响的 WebView 文件选择与分享链路，并统一控制存档文件读写。

## 目标

- 红米、其他 Android 设备均可稳定导入和导出 JSON 存档。
- 导入确认后能够完成备份、覆盖和刷新，不再无限等待。
- 导出时由系统文件保存界面直接选择位置，不再依赖分享面板。
- 旧版本生成的主存档和备份无需迁移即可继续读取。
- 不申请公共存储读写权限。
- 网页版和 Tauri 桌面版行为保持不变。

## 非目标

- 不增加云存档或跨设备同步。
- 不改变存档 JSON 格式。
- 不新增二维码、剪贴板或网盘上传功能。
- 不修改游戏数据合并规则；导入仍然是确认后整体覆盖。

## 方案

### 原生插件

新增 `PokeIdleSavePlugin`，作为 Android 存档 I/O 的唯一入口。插件提供以下方法：

- `loadGameData`：读取 `save.json` 与 `save.json.bak`。
- `saveGameData`：先把当前主存档复制为备份，再以临时文件写入并替换主存档。
- `pickImportFile`：通过 `ACTION_OPEN_DOCUMENT` 打开系统文件选择器，读取用户选择的 UTF-8 文本。
- `exportSaveData`：通过 `ACTION_CREATE_DOCUMENT` 打开系统文件保存器，把 UTF-8 JSON 写入用户选择的位置。
- `createImportBackup`：写入 `save.import-backup.json`。
- `loadImportBackup`：读取导入前备份，不存在时返回空值。

插件继续使用应用的 `filesDir`。该目录与 Capacitor `Directory.Data` 在 Android 上对应同一应用私有目录，因此现有 `save.json`、`save.json.bak` 和 `save.import-backup.json` 可以原地复用。

### SAF 文件交互

导入 Intent 使用以下约束：

- Action：`ACTION_OPEN_DOCUMENT`。
- Category：`CATEGORY_OPENABLE`。
- MIME：以 `application/json` 为主，同时允许 `text/plain` 和 `*/*`，兼容不同文件管理器对 JSON MIME 的标记差异。
- 文件最大值：读取过程中限制为 20 MB，超过后返回稳定错误码 `SAVE_TOO_LARGE`。

导出 Intent 使用以下约束：

- Action：`ACTION_CREATE_DOCUMENT`。
- Category：`CATEGORY_OPENABLE`。
- MIME：`application/json`。
- 默认文件名：沿用 `pokeidle-save-YYYYMMDD-HHMMSS.json`。
- 用户取消时返回 `null`，不显示错误。

SAF 由系统授予单次 URI 访问权限，不需要 `READ_EXTERNAL_STORAGE`、`WRITE_EXTERNAL_STORAGE` 或 `MANAGE_EXTERNAL_STORAGE`。

### JavaScript 桥接

`mobile/bridge-source.js` 使用 Capacitor `registerPlugin('PokeIdleSave')` 注册原生插件，并将现有移动端接口映射到插件：

- `loadGameData`
- `saveGameData`
- `pickImportFile`
- `exportSaveData`
- `createImportBackup`
- `loadImportBackup`

`src/save-platform.js` 在 Android 上优先调用 `mobile.pickImportFile()`。浏览器仍使用 `<input type="file">`，Tauri 仍调用 Rust 命令。

原有 JavaScript 保存队列继续保留，确保多次自动保存按顺序进入原生插件。Capacitor Filesystem 只保留给与本需求无关的代码；存档链路不再依赖它。Capacitor Share 不再参与存档导出。

### 导入事务与反馈

导入事务顺序保持不变：

1. 保存当前主存档。
2. 创建独立的导入前备份。
3. 在内存中应用导入存档。
4. 持久化新的主存档。
5. 显示成功消息并刷新游戏。

设置页在操作期间显示阶段提示：

- 导入：`正在读取存档`、`正在备份当前存档`、`正在写入新存档`。
- 导出：`请选择存档保存位置`、`正在写入导出文件`。

如果原生调用拒绝或发生 I/O 错误，现有事务回滚逻辑恢复原存档，并显示中文错误。文件选择或保存被用户取消时恢复按钮状态，不显示失败提示。

原生插件的每个 I/O 操作都必须结束于 `resolve` 或 `reject`。文件读写在插件工作线程执行，Activity 结果回调只负责接收 URI 和启动读写，避免阻塞主线程。

## 错误处理

原生插件使用稳定错误码：

| 错误码 | 含义 | 用户提示 |
| --- | --- | --- |
| `SAVE_TOO_LARGE` | 导入文件超过 20 MB | 存档文件不能超过 20 MB |
| `INVALID_FILE_URI` | 系统未返回有效文件 URI | 无法读取所选存档文件 |
| `IMPORT_READ_FAILED` | 导入文件读取失败 | 存档读取失败，请重新选择文件 |
| `EXPORT_WRITE_FAILED` | 导出文件写入失败 | 存档导出失败，请更换保存位置 |
| `IMPORT_BACKUP_FAILED` | 导入前备份写入失败 | 导入前备份失败，当前存档未改变 |
| `SAVE_WRITE_FAILED` | 主存档写入失败 | 存档写入失败，已尝试恢复当前存档 |

错误信息会保留底层异常作为日志原因，但 UI 只展示稳定、可操作的中文提示。

## 测试

- JavaScript 单元测试验证 Android 优先使用原生导入、导出和存档读写接口。
- 原生契约测试验证插件注册、SAF Intent、20 MB 限制、应用私有目录和无公共存储权限。
- 控制器测试验证取消操作、阶段反馈、写入失败回滚和成功后刷新。
- 运行完整 Node 测试及 `npm run test:mobile`。
- 运行 `npm run android:prepare`，确认 Web 资源与原生插件同步成功。
- 生成正式签名 APK 后验证 SHA-256 和 APK 签名。
- 真机验收至少覆盖一台红米设备和一台原本正常的 Android 设备。

## 验收标准

- 红米点击导入后能够选择 JSON，确认覆盖后显示进度、刷新游戏并加载新存档。
- 红米点击导出后出现系统保存位置界面，完成后能在所选目录找到并重新导入该文件。
- 用户取消导入或导出后，界面恢复可操作且不出现错误提示。
- 导入失败时原存档仍可正常加载，导入前备份不被错误覆盖。
- 升级安装后能够继续读取旧 APK 留下的主存档。
- AndroidManifest 不包含公共存储权限。
