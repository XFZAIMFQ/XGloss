# XGloss 开发约定

- 阅读 docs/ARCHITECTURE.md 和 docs/CODING_STANDARDS.md 后修改代码.
- 使用 npm 和 package-lock.json, Node.js 24 或以上.
- 领域逻辑放在 src/domain, 保持浏览器, DOM 和网络依赖在其外部.
- IndexedDB 和持久化配置统一通过后台访问. API Key 只向扩展设置页公开.
- 网页和 PDF 共用分词, 词汇状态, 覆盖率算法. 源适配器负责文本与位置.
- 翻译通过 OpenAI-compatible Chat Completions 适配器, 保留可配置 Base URL 和模型.
- 页面遍历, Range, Canvas 与事件监听必须有预算或清理路径.
- TypeScript 使用严格类型, 异步边界校验输入, 保留可操作错误反馈.
- 完成修改后运行 npm run typecheck, npm run lint, npm test 和 npm run build.
- 性能指标以真实测量为准, 记录已验证范围与待验收项目.
