# XGloss

在网页与 PDF 阅读中查词, 积累词汇, 保留原句并追踪掌握状态.

## 安装试用

当前环境使用 Node.js 24.13.0 和 npm, 依赖已安装. 生产构建位于 `.output/chrome-mv3`.

1. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`.
2. 启用开发者模式, 选择"加载已解压的扩展程序".
3. 选择项目中的 `.output/chrome-mv3` 目录.
4. 在普通网页点击 XGloss, 选择"开启 / 关闭当前网页". 选中单词即可查词并收藏.
5. 从弹窗进入 PDF 阅读器, 打开本地文件或填写在线 PDF 链接.

网页与 PDF 共用本地词库, 提供学习中, 已掌握, 忽略三种状态. 右下角面板显示当前分析范围的词汇覆盖率, 高频词和预计覆盖率增量.

## 复习与统计

从左侧导航进入"复习训练", 选择单词闪卡, 词义回忆或拼写练习. 练习使用学习中的本地词条, 标记掌握后会更新网页与 PDF 的词汇状态.

"学习统计"展示词汇状态分布, 最近更新和按词条最后修改日期汇总的日历.

## 翻译配置

在"翻译设置"点"使用 DeepSeek 预设", 填入 API Key 并保存授权. 也可以填写其他 OpenAI-compatible 服务的 Base URL 和模型名称.

```text
Base URL      https://your-provider.example/v1
模型名称       服务商提供的模型 ID
```

程序请求 `POST {baseUrl}/chat/completions`, 使用 Bearer 认证与 `model`,`messages`,`stream=false`. 本机模型可填写 `http://localhost:端口/v1`, API Key 可留空.

配置服务后, 打开词卡会自动查词. 单词和短语显示按原句语境排序的候选译义, 默认选中首项. 可先改选, 再标记熟悉度并保存译义. 选中完整句子或段落会直接显示译文. 高频词表只显示语境首选, 与词卡共用持久化缓存. 服务未配置或请求失败时, 单词可继续使用本地词典.

在线查询会将选中文字和可用原句发送给已配置的服务. 服务需要在 Chat Completions 的 `choices[0].message.content` 中返回符合提示的 JSON 字符串.

API Key 保存在本机受限的扩展配置中. 词库导出包含单词和遇词记录, 配置单独保存.

## 本地数据

- 词库页支持搜索, 手动添加词条与更改状态.
- JSON 备份保留词汇状态及遇词语境, 导入时合并并保留较新的状态.
- CSV 词表使用 `word,state` 列. state 可填写 `learning`,`known`,`ignored`, 省略时默认学习中.
- 词库与阅读位置存入本机 IndexedDB. 卸载扩展前可导出 JSON 备份.

## 开发命令

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
npm run test:browser
npm run zip
```

`npm run dev` 启动开发构建. 生产构建与浏览器验证使用 `.output/chrome-mv3`.

浏览器验证需要独立 Chromium, 可通过 `npx playwright install chromium` 准备. 验证脚本使用独立配置目录, 本机 HTTP fixture 与模拟翻译服务, 并在测试副本中预先授权 fixture 来源. 测试截图和临时数据保存在 `.cache`.

离线词典已包含 44,688 个常用英汉词条, 资源来源与固定版本记录在 `public/dictionary/source.json`. 可执行 `npm run dictionary:prepare` 重新生成, 首次生成需要下载源 CSV, 缓存位于 `.cache`. PDF 字体, CMap 和 WASM 资源通过 `npm run pdf:prepare` 准备.

## 工程说明

- [工程结构与模块边界](docs/ARCHITECTURE.md)
- [编码规范](docs/CODING_STANDARDS.md)
- [当前实现与验证范围](docs/IMPLEMENTATION_STATUS.md)
- [产品规划](PROJECT_PLAN.md)

ECDICT 与 PDF.js 的许可及随附资源许可保留在 `public/dictionary` 和 `public/pdf`, 构建时一起打包.
