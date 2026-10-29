# FundScope - 基金持仓分析平台

基于 **Node.js + Express** 与原生前端的基金持仓分析 H5 应用。输入基金代码，秒级掌握最新净值、持仓明细、持仓占比分布与市值排行，并叠加实时股票行情。

线上地址：`https://fundscope.wuhuajin.com`

---

## 功能特性

- 🔍 **基金搜索** — 内置基金列表（`data.json`）模糊匹配，combobox 支持键盘与滚动加载
- 📋 **持仓明细表** — 重仓股：股票代码、名称、当日涨跌幅、持仓占比、市值、持股数、增减持变化
- 🥧 **占比分布** — ECharts 环形图呈现前十大重仓股占比
- 📈 **市值排行** — ECharts 柱状图，按持仓市值排序
- ⚡ **实时行情** — 腾讯 / 新浪行情接口（GBK 解码），覆盖涨跌幅列
- 📊 **基金基本信息** — 净值、净值日期、当日涨跌、近 1 年收益、基金经理
- 📄 **合规就绪** — 自定义 `404.html`、`sitemap.xml`、`robots.txt`、AdSense 审核所需页面

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express（`server.js`） |
| 前端 | 原生 HTML/CSS/JS（ES6+） |
| 图表 | ECharts 5.x（CDN） |
| 数据源 | 天天基金（东方财富）公开接口 |
| 共享解析 | `js/shared.js`（前后端共用） |
| 部署 | Nginx + PM2 + Let's Encrypt SSL，阿里云 ECS |

---

## 项目结构

```
├── index.html            # 落地页
├── analyze.html          # 核心分析页
├── app.html              # 登录页
├── server.js             # Express 后端（API 代理）
├── js/
│   ├── app.js            # 前端主逻辑（图表 + 表格 + 搜索）
│   ├── shared.js         # 前后端共享解析模块
│   └── auth.js           # 登录（localStorage 演示）
├── css/                  # site.css / style.css
├── images/               # logo 资源
├── data.json             # 内置基金配置列表
├── pricing.html          # 定价页（$9.99/月，7 天试用）
├── 404.html              # 自定义 404
├── sitemap.xml / robots.txt / ads.txt
├── about/contact/privacy/terms/aigc-policy.html
├── Deploy_Simple.sh      # 服务器一键部署脚本
├── Deploy.command        # macOS 一键提交脚本
└── docs/
    ├── 网站出海实操.md          # 网站出海部署实操手册
    ├── 会员功能开发.md          # 会员 / 增值功能规划
    └── skills/fund-holding-viewer/SKILL.md  # 详细部署 SKILL
```

---

## 本地开发

```bash
npm install
npm start
# 访问 http://localhost:3000
```

静态模式（GitHub Pages）下运行时，`app.js` 会自动识别主机，无后端时回退到 CORS 代理取数。

---

## 部署

采用**子域名 HTTPS** 模式部署于阿里云 ECS（`fundscope.wuhuajin.com`）：

```
Nginx (80→443, SSL) → Node.js Express (:3000, PM2)
  ├─ /api/funds/config   基金配置
  ├─ /api/fund/info      基金信息
  ├─ /api/fund/holdings  持仓明细
  ├─ /api/stock/quote    股票行情
  └─ /*                  静态资源 + index.html
```

```bash
git clone https://github.com/whjin/fundscope.git
cd fundscope
npm install --production
pm2 start server.js --name fund-server
pm2 save && pm2 startup
```

详细手册：[docs/skills/fund-holding-viewer/SKILL.md](docs/skills/fund-holding-viewer/SKILL.md) · [docs/网站出海实操.md](docs/网站出海实操.md)

---

## 近期开发

- **整体升级改造** — 重构分析体验：持仓表格 + ECharts 环形/柱状图 + 实时行情 + 搜索下拉。
- **Google AdSense** — 补齐审核所需页面（about/contact/privacy/terms/aigc-policy）、`ads.txt`、`404.html`、`sitemap.xml`、`robots.txt`，服务 SEO 与广告变现审核。
- **缺陷修复** — `server.js` 兜底路由：不存在的路径现在返回自定义 `404.html`（HTTP 404），而非一律回退 `index.html`（HTTP 200）。

---

## 商业化状态

- **定价**：单一 Pro 档 — **$9.99/月**，7 天免费试用，随时取消。
- **当前缺口**：登录为 `localStorage` 演示（无真实后端鉴权），支付尚未接入。
- **路线图**：见 [docs/会员功能开发.md](docs/会员功能开发.md) — 先打商业化地基（真实认证 + 支付 + Free/Pro 分层 gating），再上高价值核心功能（历史净值、多基金对比），最后做差异化（AI 解读、报告导出）。

---

## License

MIT
