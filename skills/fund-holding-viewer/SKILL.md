---
name: "fund-holding-viewer"
description: "基金持仓分析H5应用全栈实现方案。Invoke when building fund holding analysis tools, financial data visualization dashboards, or dual-mode deploy (Node.js + GitHub Pages static)."
---

# 基金持仓分析系统实现方案

## 一、项目概述

通过线上公共接口获取基金最新持仓信息，使用图表和表格展示的专业金融H5应用。支持基金搜索、持仓明细、持仓占比分布图、持仓市值排行图，并展示实时涨跌幅和增减持数据。

### 技术栈
- **前端**: HTML5 + CSS3 + JavaScript (ES6+) + ECharts 5.x
- **后端**: Node.js + Express
- **数据源**: 天天基金网（基金信息+持仓）、新浪财经（股票实时行情）
- **部署**: 双模式 — Node.js 后端 / GitHub Pages 静态托管

---

## 二、项目结构

```
基金持仓/
├── index.html              # 主页面
├── css/style.css           # 深色金融仪表盘样式
├── js/app.js               # 前端核心逻辑（含静态模式解析）
├── js/shared.js            # 共享解析模块（前后端复用）
├── server.js               # Node.js 后端服务
├── data.json               # 基金配置文件
├── package.json            # 项目依赖
├── .github/workflows/
│   └── deploy.yml          # GitHub Pages 自动部署
└── skills/                 # 项目实现沉淀
    └── fund-holding-viewer/
        └── SKILL.md
```

---

## 三、数据源与API集成

### 3.1 基金基本信息
- **接口**: `https://fund.eastmoney.com/pingzhongdata/{code}.js`
- **返回格式**: JavaScript 变量赋值（非标准 JSON）
- **提取字段**: fS_name(基金名)、fS_code(代码)、Data_netWorthTrend(净值数组)、Data_currentFundManager(基金经理)、syl_1n/1y/3y(收益率)
- **解析方式**: 通过 `extractVar()` 函数按变量名提取，支持括号深度平衡匹配，避免被数组内部字符截断

### 3.2 基金持仓明细
- **接口**: `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10`
- **返回格式**: `var apidata = { content: "<HTML表格>", ... }`
- **解析逻辑**:
  1. `safeEval()` 解析 apidata 对象
  2. 从 `<h4>` 标签提取基金名称和报告期
  3. 正则提取前2个 `<table>`（最新季度 + 上一季度）
  4. `buildColumnMap()` 根据表头动态映射列索引（股票代码/名称/占比/持股数/市值）
  5. 对比两个季度数据计算增减持（新增/持平/+x.xx%/-x.xx%）
  6. 按占比降序排序

### 3.3 股票实时行情
- **接口**: `https://hq.sinajs.cn/list={sz|sh|hk}{code}`
- **返回格式**: `var hq_str_sz000001="平安银行,12.34,12.30,12.45,..."`
- **编码**: GBK，需 `TextDecoder('gbk')` 解码
- **提取字段**: parts[2]=昨日收盘价, parts[3]=当前价格 → 计算涨跌幅 `(current - prevClose) / prevClose * 100`
- **市场判断**: `getMarketByCode()` — 6位代码前缀6→sh, 0/3→sz; 5位代码→hk(港股)

### 3.4 基金配置
- **文件**: `data.json`
- **格式**: `{ "funds": [{ "name": "基金名称", "code": "000001" }] }`
- **用途**: 下拉选择列表，按文件顺序展示

---

## 四、双模式架构

### 4.1 模式检测
```javascript
const IS_STATIC = window.location.hostname.endsWith('.github.io') ||
    (window.location.protocol === 'https:' && !window.location.port &&
     !window.location.hostname.includes('localhost'));
```

### 4.2 后端模式（本地开发 / 阿里云部署）
- 前端请求 `/api/fund/info`, `/api/fund/holdings`, `/api/stock/quote`, `/api/funds/config`
- Node.js 后端代理请求，处理 GBK 解码、HTML 解析、跨域
- 优势：稳定可靠，无第三方依赖

### 4.3 静态模式（GitHub Pages）
- 通过 CORS 代理（allorigins.win / corsproxy.io）直接请求上游 API
- 客户端完成所有解析逻辑（从 server.js 移植）
- `fetchFundConfig()` → 直接 fetch data.json
- `fetchFundInfo()` → CORS代理请求 pingzhongdata.js → `parseFundInfoScript()` 客户端解析
- `fetchFundHoldings()` → CORS代理请求 FundArchivesDatas.aspx → `parseHoldingsScript()` 客户端解析
- `fetchStockQuotes()` → CORS代理请求新浪 → `TextDecoder('gbk')` 解码

---

## 五、核心实现细节

### 5.1 共享解析模块 (shared.js)
为避免前后端解析逻辑重复，提取到 `js/shared.js`，采用 UMD 设计（浏览器全局 `FundShared` + Node `module.exports`）：
```javascript
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.FundShared = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    return { safeEval, findMatching, extractVar, extractStringVar, extractNumberVar,
             stripTags, toNumber, buildColumnMap, getMarketByCode,
             parseFundInfo, parseHoldings };
});
```
- **后端引用**: `const S = require('./js/shared.js')`
- **前端引用**: `<script src="js/shared.js"></script>` → 全局 `FundShared` 对象
- **包含函数**: 所有解析相关函数（变量提取、HTML解析、基金信息解析、持仓解析等）

### 5.2 JS变量提取器
天天基金返回的是 JS 脚本而非 JSON，需要从 `var xxx = ...;` 中提取值：
```javascript
function extractVar(script, name) {
    // 1. 定位 var name = 
    // 2. 根据首字符判断类型: {对象} [数组] "字符串" 数字
    // 3. 对象/数组用 findMatching() 括号深度匹配
    // 4. 字符串用引号匹配（处理转义）
    // 5. safeEval() 安全求值
}
```

### 5.3 HTML表格解析
持仓数据嵌在 HTML 表格中，服务端用正则解析：
- `<thead>` 提取表头 → `buildColumnMap()` 动态映射列
- `<tbody>` 的 `<tr>` 逐行提取 `<td>` 文本
- `stripTags()` 去除 HTML 标签
- `toNumber()` 处理千分位、百分号

### 5.4 港股代码支持
- A股代码为6位数字，港股代码为5位数字（如 00981 中芯国际）
- 正则 `/^\d{5,6}$/` 同时匹配
- `getMarketByCode()` 返回 0(sz)/1(sh)/2(hk)
- 新浪接口前缀: sz/sh/hk

### 5.5 ECharts 图表自适应
- **环形图**: 百分比半径 `['40%', '70%']`，外部标签+引导线，`labelLayout: { hideOverlap: true }`
- **柱状图**: Canvas 测量文本宽度 → 动态计算 `grid.left/right`，确保标签完整显示
- **ResizeObserver**: 监听容器尺寸变化，自动重新渲染图表
- **setOption后调用 resize()**: 确保 canvas 与容器同步

### 5.6 搜索下拉组合框
#### 基础功能
- 输入框 + 下拉列表 + 清空图标
- focus 事件直接显示下拉（不判断输入框是否为空）
- 显示基金名称，内部传递基金代码
- `mousedown` 事件 + `preventDefault()` 防止输入框失焦
- `z-index: 10` 确保下拉层级

#### 分页加载机制
- **默认显示**: 8条数据（`PAGE_SIZE = 8`）
- **滚动触底**: 监听 `scroll` 事件，当 `scrollTop + clientHeight >= scrollHeight - 20` 时加载更多
- **加载提示**: 显示"下拉加载更多..."，带呼吸闪烁动画
- **分页重置**: 搜索时重置 `displayCount = PAGE_SIZE`，从首页开始
- **全部加载**: 所有数据加载完成后自动隐藏加载提示

#### 高度计算策略（解决下拉列表截断问题）
```javascript
function renderDropdown(list, keyword) {
    // 1. 清除旧的 maxHeight 限制
    dropdown.style.maxHeight = 'none';
    
    // 2. 填充内容
    dropdown.innerHTML = visibleItems.map(...);
    
    // 3. 显示下拉列表（移除 hidden 类）
    dropdown.classList.remove('hidden');
    
    // 4. 同步强制布局，测量自然高度
    const naturalHeight = dropdown.scrollHeight;
    const fallbackHeight = visibleItems.length * 49 + (hasMore ? 40 : 0) + 12;
    const actualHeight = naturalHeight > 0 ? naturalHeight : fallbackHeight;
    
    // 5. 设置合理的最大高度限制
    dropdown.style.maxHeight = Math.min(actualHeight, 650) + 'px';
}
```
- **关键**: 必须先移除 `hidden` 类让元素可见，再测量 `scrollHeight`
- **回退机制**: 若 `scrollHeight` 为 0（隐藏状态），使用估算值 `items.length * 49 + loadMoreHeight + padding`
- **高度上限**: 650px，超出则启用滚动

#### 下拉关闭策略
- **不自动关闭**: 移除 `blur` 事件自动关闭逻辑
- **点击外部关闭**: 监听 `document.addEventListener('click', ...)` 判断点击区域
- **选项选择**: `mousedown` + `preventDefault()` 防止 blur 触发，确保选择后才关闭

### 5.7 涨跌颜色规范
- A股惯例：**红涨绿跌**（与欧美相反）
- `.up { color: #ef4444 }` / `.down { color: #10b981 }`
- 新增标注：`<span class="new-tag">新增</span>`

---

## 六、UI设计规范

### 6.1 深色金融仪表盘风格
- 主背景: `#0a1628`（深海蓝）
- 卡片背景: `rgba(16, 31, 54, 0.8)` + `backdrop-filter: blur(20px)`
- 强调色: `#d4af37`（金色）
- 文字层次: primary `#e8ecf4` / muted `#8b9bb4`
- 边框: `rgba(212, 175, 55, 0.15)`
- 圆角: 20px（卡片）/ 12px（输入框按钮）

### 6.2 布局
- 搜索区：居中，最大宽度 700px
- 持仓明细表格：全宽，表格上方
- 图表区：`grid-template-columns: repeat(auto-fit, minmax(480px, 1fr))`
- 响应式断点：768px

### 6.3 下拉列表样式规范
#### 基础样式
- **背景**: `rgba(10, 22, 40, 0.95)` + `backdrop-filter: blur(20px)`
- **边框**: `1px solid rgba(212, 175, 55, 0.2)` + `border-radius: 14px`
- **阴影**: `0 12px 40px rgba(0, 0, 0, 0.5), 0 0 20px rgba(212, 175, 55, 0.08)`
- **层级**: `z-index: 1000`（确保显示在最上层）
- **滚动条**: 宽度 6px，金色半透明样式

#### 列表项样式
- **布局**: flex + space-between（名称左、代码右）
- **间距**: padding 12px 16px，margin-bottom 2px
- **悬停**: 背景渐变高亮，过渡动画 0.15s
- **选中**: `.active` 类高亮样式

#### 加载更多提示
- **样式**: 金色文字 + 渐变背景 + 顶部分割线
- **动画**: `pulse-load-more` 1.5s 呼吸闪烁
- **内容**: "下拉加载更多..."

#### 高亮匹配
- **关键词**: `.highlight` 类高亮匹配的搜索关键词
- **颜色**: 使用强调色金色 `#d4af37`

---

## 七、部署方案

### 7.1 GitHub Pages（静态模式）
1. 推送代码到 GitHub 仓库
2. Settings → Pages → Source: GitHub Actions
3. `.github/workflows/deploy.yml` 自动部署静态文件
4. 访问 `https://用户名.github.io/仓库名/`
5. 静态模式自动激活，通过 CORS 代理获取数据

### 7.2 阿里云服务器（后端模式）

#### 7.2.1 一键部署（推荐）

项目提供完整的一键部署脚本，适用于 Alibaba Cloud Linux 3 / CentOS 8+。

```bash
# 1. 上传部署脚本到服务器
scp scripts/deploy.sh root@你的服务器IP:/root/

# 2. 登录服务器执行
ssh root@你的服务器IP
chmod +x /root/deploy.sh
bash /root/deploy.sh
```

部署脚本自动完成：
- ✅ 系统软件包更新
- ✅ Node.js / Git / Nginx 安装
- ✅ PM2 进程管理器安装
- ✅ 项目代码拉取
- ✅ 依赖安装
- ✅ 服务启动 + 开机自启
- ✅ Nginx 反向代理配置
- ✅ 防火墙配置
- ✅ 部署结果验证

#### 7.2.2 手动部署步骤

如果需要自定义配置，可按以下步骤手动部署：

**1. 环境准备**
```bash
# 更新系统
dnf update -y

# 安装基础软件
dnf install -y nodejs npm git nginx

# 安装 PM2
npm install pm2 -g
```

**2. 部署项目**
```bash
# 创建项目目录
mkdir -p /www
cd /www

# 拉取代码
git clone https://github.com/whjin/fundscope.git
cd fundscope

# 安装依赖
npm install --production

# 启动服务
pm2 start server.js --name fund-server
pm2 save
pm2 startup systemd
```

**3. Nginx 配置**

参考 `configs/nginx-http.conf` 或 `configs/nginx-https.conf`，将配置文件复制到 `/etc/nginx/conf.d/` 目录。

```bash
# 测试配置
nginx -t

# 重载配置
systemctl reload nginx
```

#### 7.2.3 部署脚本说明

| 脚本 | 位置 | 说明 |
|------|------|------|
| 一键部署 | `scripts/deploy.sh` | 全新服务器一键部署 |
| 健康诊断 | `scripts/diagnose.sh` | 一键检查服务状态、资源、日志 |
| 代码更新 | `scripts/update.sh` | 拉取最新代码并重启服务 |

**使用方法：**
```bash
# 健康诊断
bash scripts/diagnose.sh

# 代码更新
bash scripts/update.sh
```

#### 7.2.4 配置文件模板

| 配置文件 | 位置 | 说明 |
|----------|------|------|
| Nginx HTTP | `configs/nginx-http.conf` | 基础 HTTP 配置 |
| Nginx HTTPS | `configs/nginx-https.conf` | 完整 HTTPS 配置（含 SSL） |
| PM2 生态 | `configs/ecosystem.config.js` | PM2 配置文件 |

#### 7.2.5 Windows 远程部署

在 Windows 环境下可使用 PuTTY 工具链（plink + pscp）进行远程部署。

详细说明见 `windows/README.md`，包含：
- plink/pscp 工具使用方法
- 密码认证 / 密钥认证配置
- 一键远程部署脚本示例
- 常见问题解答

#### 7.2.6 部署验证

```bash
# 1. 检查 PM2 服务状态
pm2 status

# 2. 测试本地服务
curl http://127.0.0.1:3000/api/funds/config

# 3. 测试 Nginx 代理
curl -H "Host: fundscope.wuhuajin.com" http://127.0.0.1

# 4. 运行诊断脚本
bash scripts/diagnose.sh
```

#### 7.2.7 常见部署问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 502 Bad Gateway | Node.js 服务未启动 | `pm2 status` 检查，`pm2 restart fund-server` 重启 |
| 403 Forbidden | Nginx 权限问题 | 检查文件权限和 SELinux 配置 |
| 域名无法访问 | 未备案 / DNS 未生效 | 国内服务器需 ICP 备案，检查 DNS 解析 |
| 端口无法访问 | 安全组未开放 | 阿里云控制台安全组开放 80/443 端口 |
| 服务自动停止 | 内存不足 / 代码崩溃 | 查看 `pm2 logs`，增加内存或修复 bug |

---

**详细部署文档**：请参考 [`DEPLOY.md`](./DEPLOY.md)，包含完整的部署流程、HTTPS 配置、故障排查等内容。

---

## 八、常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 基金接口返回404 | fundgz.1234567.com.cn 不可用 | 切换到 fund.eastmoney.com 接口 |
| 跨域错误 | 浏览器直接请求第三方API | Node.js 后端代理 / CORS 代理 |
| 中文乱码 | 新浪API返回GBK编码 | `TextDecoder('gbk')` 解码 |
| 基金名称只取到1字 | 正则匹配错误 | `buildColumnMap()` 动态列映射 |
| 港股被过滤 | 正则只匹配6位代码 | 改为 `/^\d{5,6}$/` |
| 图表与图例重叠 | ECharts半径用像素值 | 改用百分比半径 + ResizeObserver |
| 容器变化图表不更新 | 未监听resize | `ResizeObserver` + `setOption后resize()` |
| 浏览器缓存 | CSS/JS修改不生效 | 版本号参数 `?v=29` + 禁用静态缓存 |
| 端口占用 | Node进程未关闭 | `Stop-Process -Name node -Force` |
| 下拉列表显示不全 | scrollHeight在隐藏状态下为0 | 先移除hidden类再测量高度，添加回退估算值 |
| 下拉列表只显示8条 | 未实现分页加载 | 实现scroll触底监听，每次加载PAGE_SIZE条 |
| 下拉自动关闭 | blur事件触发关闭 | 移除blur关闭逻辑，改为点击外部关闭 |
| 下拉层级被遮挡 | z-index过低 | 设置 `.fund-dropdown { z-index: 1000 }` |
| 输入框显示基金代码 | 选择时赋值错误 | 修改为 `input.value = name` 而非code |
| 搜索按钮被拉伸 | height不一致 | 统一高度54px，使用align-items:center |
| 代码重复冗余 | 前后端解析逻辑重复 | 提取shared.js共享模块，UMD设计 |

---

## 九、版本演进记录

1. **v1**: 基础功能 — 基金搜索 + 持仓表格展示
2. **v2**: 图表可视化 — 环形图 + 柱状图
3. **v3**: data.json配置 — 下拉选择基金
4. **v4**: 实时行情 — 涨跌幅 + 增减持
5. **v5**: UI优化 — 下拉组合框 + 清空图标 + 层级修复
6. **v6**: 图表修复 — 响应式布局 + ResizeObserver
7. **v7**: 港股支持 — 5位代码 + 新浪hk前缀
8. **v8**: 双模式部署 — GitHub Pages 静态模式 + CORS代理
9. **v9**: 代码优化 — shared.js共享模块 + UMD设计 + 冗余消除
10. **v10**: 下拉分页 — 分页加载 + 触底加载更多 + 加载提示
11. **v11**: 下拉修复 — 高度计算修复 + 不自动关闭 + 滚动位置保持
12. **v12**: 样式完善 — 下拉列表视觉规范 + 动画效果 + 交互体验优化

---

## 十、核心优化总结

### 10.1 下拉列表问题修复
| 问题 | 根本原因 | 解决方案 |
|------|----------|----------|
| 列表只显示部分数据 | `scrollHeight`在隐藏状态下测量为0 | 先移除`hidden`类再测量，添加回退估算值 |
| 分页加载后内容错位 | 重新渲染导致滚动位置丢失 | 保存`scrollTop`后恢复 |
| 搜索时重置分页 | 未清除`displayCount` | `filterList()`中重置为`PAGE_SIZE` |
| 加载提示无反馈 | 无视觉动画 | 添加CSS关键帧动画 |

### 10.2 图表自适应优化
| 问题 | 解决方案 |
|------|----------|
| 容器宽度变化时图表重叠 | ResizeObserver监听 + 动态grid计算 |
| 标签文本过长被截断 | Canvas测量文本宽度 + 动态边距 |
| 饼图图例与图形重叠 | 外部标签+引导线 + hideOverlap |

### 10.3 代码结构优化
| 优化项 | 说明 |
|--------|------|
| 共享模块 | 提取解析逻辑到shared.js，前后端复用 |
| UMD设计 | 同时支持浏览器全局和Node模块 |
| 函数封装 | 合并重复的请求函数，统一错误处理 |

### 10.4 交互体验优化
| 功能 | 实现方式 |
|------|----------|
| 清空图标 | 动态显示/隐藏，点击清空并聚焦 |
| 输入框显示名称 | 选择基金时显示名称，内部传递代码 |
| focus直接显示 | 移除空值判断，聚焦即显示下拉 |
| 点击外部关闭 | document级click监听，判断点击区域 |
| 键盘导航 | 支持上下箭头选择，Enter确认 |
