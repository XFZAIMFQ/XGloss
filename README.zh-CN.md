<div align="center">
  <img src="public/icon/logo.svg" width="72" height="72" alt="XGloss Logo" />
  <h1>XGloss</h1>
  <p>
    <strong>本地优先的网页词汇学习扩展.</strong><br />
    在网页阅读中结合原句语境查词, 积累生词与例句, 并持续追踪掌握进度.
  </p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge%20MV3-18181b" alt="Chrome / Edge MV3" />
    <img src="https://img.shields.io/badge/Stack-Vue%203%20%2B%20TypeScript-41b883" alt="Vue 3 + TypeScript" />
    <img src="https://img.shields.io/badge/Node.js-%3E%3D%2024-339933" alt="Node.js >= 24" />
  </p>
  <p>
    <a href="README.md">English</a> | <strong>简体中文</strong>
  </p>
</div>

---

## 核心特性

- **按站点控制网页分析**: 按主机名灵活开关网页分析, 停用时即时释放页面高亮与浮层资源.
- **Spotlight 视口高亮**: 基于 CSS Custom Highlight API 在视口附近按状态高亮词汇(全局限制 `5,000` 个活跃 Range), 跨网页标签页实时同步.
- **阅读覆盖率面板**: 实时统计当前分析范围的词汇覆盖率、待确认高频生词与预计覆盖率增量, 支持手动刷新批次与**回想模式**(先回想再点开释义).
- **三档划词触发 (`自动` / `图标` / `关闭`)**: 在扩展图标弹窗内一键切换选中后立即翻译、选中后先显示 `26x26` 悬浮图标再点击翻译, 或关闭网页划词响应(不影响阅读面板内点词).
- **多语种词库收藏集与语言方向联动**: 支持 8 种学习语言(`EN`, `JA`, `KO`, `DE`, `FR`, `ES`, `RU`, `IT`)的分类词库管理、置顶与统计; 在弹窗中切换 `当前词库` 后新标记词条默认写入该词库并单向同步 `原语言`, 同时支持独立微调 `原语言 -> 目标语言`.
- **语境在线翻译 (OpenAI-compatible)**:
    - 支持任意 **OpenAI-compatible Chat Completions** 服务(内置 DeepSeek 预设, 并兼容无需 API Key 的本机 `http://localhost` 服务).
    - 单词与短语返回按原句语境排序的候选译义(最多 5 项, 支持按遇词分别保存所选释义), 长句与段落直接返回完整译文.
    - 单词卡右下角支持临时切换当前卡片的 `原语言 -> 目标语言`, 立即重新翻译且不修改全局默认设置.
- **复习训练与 GitHub 风格学习日历**:
    - 提供**单词闪卡**、**词义 -> 单词**与**拼写练习**三种模式, 支持按词库与每次词数(`10` / `20` / `50`)筛选.
    - 词库表格内联 4 档学习等级(`1-4`) / `已掌握` / `忽略` 评分与最近一年每日学习活动热力图.
- **本地优先与凭据隔离**: 词条、遇词记录与翻译缓存全部存储在扩展源 IndexedDB; API Key 存于 `TRUSTED_CONTEXTS` 受限存储中, 仅设置页可读取与编辑.

## 快速开始

### 环境要求

- Node.js `>= 24` 与 `npm`
- Chromium 内核浏览器(Chrome 或 Microsoft Edge, Manifest V3)

### 构建与加载扩展

```powershell
npm ci
npm run build
```

1. 在 Chrome 中打开 `chrome://extensions` (或 Edge 中打开 `edge://extensions`).
2. 开启右上角**开发者模式**.
3. 点击**加载已解压的扩展程序**, 选择项目中的 `.output/chrome-mv3` 目录.
4. 在普通网页点击 XGloss 图标即可开关当前站点分析、切换划词触发模式(`自动` / `图标` / `关闭`)、切换默认词库与翻译方向, 或打开**我的词库**与**翻译设置**.

## 翻译服务配置

从左侧导航或扩展弹窗右上角进入**翻译设置** (`options.html`):

1. 可直接点击**使用 DeepSeek 预设**, 或填写其他 OpenAI-compatible 接口信息:
    - **Base URL**: 服务根地址, 如 `https://api.deepseek.com` 或 `https://your-provider.example/v1`(本机模型可用 `http://localhost:<端口>/v1`).
    - **API Key**: 保存在本机受限扩展存储中; 本机免鉴权服务可留空.
    - **模型名称**: 服务商提供的模型 ID.
    - **目标语言**与**超时(毫秒)**: 默认目标语言为简体中文, 超时默认 `30000 ms`.
2. 点击**保存并授权**为目标来源申请扩展访问权限, 可用**测试语境翻译**验证连通性.

扩展向 `{baseUrl}/chat/completions` 发送 `POST` 请求(`model`, `temperature: 0.1`, `messages`, `stream: false`), 校验 `choices[0].message.content` 中的 JSON 结构. 词卡与高频词表共用 IndexedDB 翻译缓存(`version: 4`, 按配置、原语言/目标语言、选词与原句隔离).

## 本地数据与备份

- **我的词库 (`library.html`)**: 创建/编辑/置顶多语种词库、搜索与筛选词条、查看遇词原句上下文、编辑自定义释义及行内修改熟悉度.
- **JSON v2 导入导出**: 完整保存词库集合、词汇状态、已选释义、遇词记录与学习活动; 导入时执行事务合并, 保留较新的词汇状态并兼容旧版 JSON v1 备份.
- **CSV 导入导出**: 支持 `word,state,level,meaning` 列(`state` 可为 `learning`, `known`, `ignored`, 省略默认 `learning`).
- 所有数据默认仅保存在本地 IndexedDB, 卸载扩展前建议导出 JSON 备份.

## 开发与测试命令

```powershell
npm ci                  # 安装依赖
npm run dev             # 启动 WXT 开发构建
npm run typecheck       # 运行 vue-tsc --noEmit 类型检查
npm run lint            # 运行 ESLint 检查
npm run format:check    # 运行 Prettier 格式校验
npm test                # 运行 Vitest 单元测试与 IndexedDB 回归
npm run build           # 构建 .output/chrome-mv3 生产包
npm run test:browser    # 运行 Playwright Chromium 端到端冒烟测试
npm run zip             # 打包扩展压缩包至 .output/
```

运行浏览器冒烟测试前请先准备独立 Chromium (`npx playwright install chromium`). `tests/browser-smoke.mjs` 会启动本地 HTTP 测试页与模拟 Chat Completions 服务对 `.output/chrome-mv3` 做完整回归, 截图与临时配置输出至 `.cache/`.

## 工程文档

- [工程架构与模块边界](docs/ARCHITECTURE.md)
- [编码规范](docs/CODING_STANDARDS.md)
- [当前实现与验证范围](docs/IMPLEMENTATION_STATUS.md)
- [产品规划与调研](PROJECT_PLAN.md)
- [仓库开发约定](AGENTS.md)

## 第三方组件与资源许可

随扩展构建打包的第三方字体与图标保留其原始许可:

- **Lucide Icons**: [public/licenses/Lucide-LICENSE.txt](public/licenses/Lucide-LICENSE.txt)
- **Nunito Font**: [public/licenses/Nunito-OFL.txt](public/licenses/Nunito-OFL.txt)

## 开源协议

基于 [MIT License](LICENSE) 开源.
