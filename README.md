# FundScope - 基金持仓分析平台

基于 Node.js + Express 的基金持仓分析 H5 应用，支持基金搜索、持仓明细展示、实时行情和可视化图表。

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JS + ECharts
- **部署**: Nginx + PM2 + Let's Encrypt SSL

## 本地开发

```bash
npm install
npm start
# 访问 http://localhost:3000
```

## 部署

详细部署流程请参考 [skills/fund-holding-viewer/SKILL.md](skills/fund-holding-viewer/SKILL.md)。

```bash
# 服务器上快速启动
git clone https://github.com/whjin/fundscope.git
cd fundscope
npm install --production
pm2 start server.js --name fund-server
pm2 save && pm2 startup
```

## 项目结构

```
├── index.html          # 入口页面
├── server.js           # Express 后端服务
├── js/
│   ├── app.js          # 前端主逻辑
│   └── shared.js       # 前后端共享解析模块
├── css/style.css       # 样式
├── data.json           # 基金配置列表
├── Deploy.command      # macOS 一键提交脚本
└── skills/             # 部署文档
```
