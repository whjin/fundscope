# FundScope - Fund Holdings Analysis Platform

A fund holdings analysis H5 application built with **Node.js + Express** and native frontend. Enter a fund code to instantly view latest net value, holdings details, holding-ratio distribution, and market-cap ranking — with real-time stock quotes.

Live site: `https://fundscope.wuhuajin.com`

---

## Features

- 🔍 **Fund search** — fuzzy matching over a built-in fund list (`data.json`), combobox with keyboard + scroll support
- 📋 **Holdings table** — top holdings: stock code, name, day change %, holding ratio, market value, shares, and add/reduce changes
- 🥧 **Holding-ratio distribution** — ECharts donut chart of the top 10 holdings
- 📈 **Market-cap ranking** — ECharts bar chart, sorted by holding value
- ⚡ **Real-time stock quotes** — Tencent / Sina quote feed (GBK-decoded), overlays day-change %
- 📊 **Fund basics** — net value, net-value date, day change, 1-year return, fund manager
- 📄 **Compliance-ready** — custom `404.html`, `sitemap.xml`, `robots.txt`, and AdSense review pages

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express (`server.js`) |
| Frontend | Native HTML/CSS/JS (ES6+) |
| Charts | ECharts 5.x (CDN) |
| Data source | Tiantian Fund (eastmoney) public APIs |
| Shared parsing | `js/shared.js` (shared between Node & browser) |
| Deployment | Nginx + PM2 + Let's Encrypt SSL, Aliyun ECS |

---

## Project Structure

```
├── index.html            # Landing page
├── analyze.html          # Core analysis page
├── app.html              # Login page
├── server.js             # Express backend (API proxy)
├── js/
│   ├── app.js            # Frontend main logic (charts + table + combobox)
│   ├── shared.js         # Shared parsing module (Node + browser)
│   └── auth.js           # Login (localStorage demo)
├── css/                  # site.css / style.css
├── images/               # logo assets
├── data.json             # Built-in fund list config
├── pricing.html          # Pricing ($9.99/mo, 7-day trial)
├── 404.html              # Custom 404
├── sitemap.xml / robots.txt / ads.txt
├── about/contact/privacy/terms/aigc-policy.html
├── Deploy_Simple.sh      # One-click server deploy script
├── Deploy.command        # macOS one-click commit script
└── docs/
    ├── 网站出海实操.md          # Website overseas deployment playbook (zh)
    ├── 会员功能开发.md          # Membership / premium feature plan (zh)
    └── skills/fund-holding-viewer/SKILL.md  # Detailed deployment SKILL
```

---

## Quick Start

```bash
npm install
npm start
# Visit http://localhost:3000
```

Run in dev/static mode (GitHub Pages) — `app.js` automatically detects the host and falls back to CORS proxies when no backend is present.

---

## Deployment

Deployed via **subdomain HTTPS** (`fundscope.wuhuajin.com`) on an Aliyun ECS:

```
Nginx (80→443, SSL) → Node.js Express (:3000, PM2) 
  ├─ /api/funds/config   fund config
  ├─ /api/fund/info      fund info
  ├─ /api/fund/holdings  holdings details
  ├─ /api/stock/quote    stock quotes
  └─ /*                  static assets + index.html
```

```bash
git clone https://github.com/whjin/fundscope.git
cd fundscope
npm install --production
pm2 start server.js --name fund-server
pm2 save && pm2 startup
```

Full playbook: [docs/skills/fund-holding-viewer/SKILL.md](docs/skills/fund-holding-viewer/SKILL.md) · [docs/网站出海实操.md](docs/网站出海实操.md)

---

## Recent Development

- **Analyze page UX fixes** — fixed flex layout collapse (`.container` / `.analyze-nav` now `width:100%`), fixed hidden main-content after query success, and switched the loading overlay from full-screen absolute cover to an in-flow card below the search bar so the search box never disappears when switching funds; data updates in place instead of a full-page re-render.
- **Subscription CTA** — added a gold-gradient `.cta-banner` on `analyze.html` (between search and results) linking to `pricing.html` for the 7-day free trial.
- **Overall upgrade** — rebuilt the analysis experience: holdings table + ECharts donut/bar + real-time quotes + combobox search.
- **Google AdSense** — added review-required pages (`about/contact/privacy/terms/aigc-policy.html`), `ads.txt`, `404.html`, `sitemap.xml`, `robots.txt` for SEO & monetization review.
- **Bug fix** — `server.js` catch-all now serves a custom `404.html` (HTTP 404) instead of always returning `index.html` with HTTP 200.
- **Repo hygiene** — stripped macOS AppleDouble metadata (`._*`) and `.DS_Store` files from the working tree.

---

## Commercialization Status

- **Pricing**: single Pro tier — **$9.99/month**, 7-day free trial, cancel anytime.
- **Current gap**: login is a `localStorage` demo (no real backend auth) and payments are not wired up yet.
- **Roadmap**: see [docs/会员功能开发.md](docs/会员功能开发.md) — first build the commercialization foundation (real auth + payment + Free/Pro gating), then ship high-value core features (net-value trend, multi-fund compare), then differentiation (AI insights, reports).

---

## License

MIT
