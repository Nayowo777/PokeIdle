# 项目地址展示设计

## 目标

在游戏设置页同时展示原项目地址和当前 Android 增强分支地址，并在 README 中说明两者关系、Android 功能和构建入口。

## 方案

- 设置页保留现有“原项目地址”，链接到 `https://github.com/ZTMYO/PokeIdle`。
- 新增“Android 分支地址”，链接到 `https://github.com/Nayowo777/PokeIdle/tree/feature/save-transfer`。
- 两个链接复用现有 `.settings-footer-link` 样式和安全的外部链接属性。
- README 新增项目关系说明、Android 功能摘要、APK 构建命令和输出位置。
- 使用静态契约测试锁定两个设置页链接和 README 关键内容，防止上游合并时回退。

## 验证

- 运行项目完整 Node 测试。
- 运行移动端测试和 `npm run android:prepare`，确认设置页链接进入移动端 Web 资源。
- 运行 `git diff --check`。
