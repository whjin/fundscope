/* ==========================================================
 * 基金持仓展示系统 - Node.js 后端服务
 *  真实线上数据源：
 *   1. 基础信息+净值：https://fund.eastmoney.com/pingzhongdata/{code}.js
 *   2. 持仓明细HTML ：https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc
 * ========================================================== */

const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 共享解析模块（与前端 app.js 共用）
const S = require('./js/shared.js');

const app = express();
const PORT = process.env.PORT || 3000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 20000;

/**
 * 跟随重定向的 HTTP(S) GET，返回 { status, buffer, text }
 * 合并了原 requestText 和 requestRaw，同时提供文本和原始 Buffer
 */
function requestGet(targetUrl, referer = '', depth = 0) {
    return new Promise((resolve, reject) => {
        if (depth > 5) return reject(new Error('重定向次数过多'));
        let u;
        try { u = new URL(targetUrl); }
        catch (e) { return reject(new Error('URL 无效: ' + targetUrl)); }
        const lib = u.protocol === 'https:' ? https : http;

        const req = lib.request({
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: 'GET',
            headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'Referer': referer },
            timeout: TIMEOUT
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = new URL(res.headers.location, targetUrl).toString();
                return requestGet(next, referer, depth + 1).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({ status: res.statusCode, buffer, text: buffer.toString('utf8') });
            });
        });
        req.on('timeout', () => req.destroy(new Error('请求超时 (' + TIMEOUT / 1000 + 's)')));
        req.on('error', reject);
        req.end();
    });
}

/**
 * 使用 GBK 解码 Buffer 为字符串
 */
function decodeGBK(buf) {
    try { return new TextDecoder('gbk').decode(buf); }
    catch (e) {
        try { return new TextDecoder('gb18030').decode(buf); }
        catch (e2) { return buf.toString('utf8'); }
    }
}

// ================================================================
// Express 路由
// ================================================================

app.use(express.static(path.join(__dirname), {
    index: false,
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

app.get('/api/fund/info', async (req, res) => {
    const code = String(req.query.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ success: false, message: '请输入正确的6位基金代码' });
    }
    try {
        const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
        const { status, text } = await requestGet(url, `https://fund.eastmoney.com/${code}.html`);
        if (status !== 200 || !text) {
            return res.status(502).json({ success: false, message: `上游返回异常 (HTTP ${status})` });
        }
        const data = S.parseFundInfo(text, code);
        if (!data || (!data.fundcode && !data.name)) {
            return res.status(502).json({ success: false, message: '未解析到基金数据（可能基金代码不存在或接口变更）' });
        }
        res.json({ success: true, data });
    } catch (err) {
        console.error('[api/fund/info]', err.message);
        res.status(500).json({ success: false, message: '网络错误: ' + err.message });
    }
});

app.get('/api/fund/holdings', async (req, res) => {
    const code = String(req.query.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ success: false, message: '请输入正确的6位基金代码' });
    }
    try {
        const targets = [
            `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=&rt=${Date.now()}`,
            `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${new Date().getFullYear()}&month=&rt=${Date.now()}`
        ];
        let lastErr = null, data = null;
        for (const t of targets) {
            try {
                const { status, text } = await requestGet(t, `https://fundf10.eastmoney.com/ccmx_${code}.html`);
                if (status !== 200 || !text) { lastErr = new Error(`上游返回异常 (HTTP ${status})`); continue; }
                data = S.parseHoldings(text, code);
                if (data && data.data && data.data.length) break;
                if (!data) lastErr = new Error('HTML解析失败');
            } catch (e) { lastErr = e; }
        }
        if (!data || !data.data || data.data.length === 0) {
            return res.status(502).json({
                success: false,
                message: lastErr ? '持仓数据获取失败: ' + lastErr.message : '未获取到持仓数据（可能该基金未披露或尚未建仓）'
            });
        }
        res.json({ success: true, data });
    } catch (err) {
        console.error('[api/fund/holdings]', err.message);
        res.status(500).json({ success: false, message: '网络错误: ' + err.message });
    }
});

app.get('/api/funds/config', (_req, res) => {
    try {
        const dataPath = path.join(__dirname, 'data.json');
        if (!fs.existsSync(dataPath)) return res.json({ success: true, funds: [] });
        const json = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        res.json({ success: true, funds: json.funds || [] });
    } catch (err) {
        console.error('[api/funds/config]', err.message);
        res.status(500).json({ success: false, message: '读取配置失败' });
    }
});

app.get('/api/stock/quote', async (req, res) => {
    const codes = String(req.query.codes || '').trim();
    if (!codes) return res.status(400).json({ success: false, message: '请提供股票代码' });
    const codeList = codes.split(',').map(c => c.trim()).filter(c => /^\d{5,6}$/.test(c));
    if (!codeList.length) return res.status(400).json({ success: false, message: '股票代码格式错误' });

    try {
        const results = {};
        
        // 转换为腾讯财经的代码格式（和新浪一样：sz/sh/hk + 代码）
        const tencentCodes = codeList.map(code => {
            const market = S.getMarketByCode(code);
            const prefix = market === 0 ? 'sz' : (market === 1 ? 'sh' : 'hk');
            return `${prefix}${code}`;
        }).join(',');

        const { status, buffer } = await requestGet(
            `https://qt.gtimg.cn/q=${tencentCodes}`,
            'https://gu.qq.com/'
        );

        if (status === 200 && buffer) {
            const text = decodeGBK(buffer);
            const lines = text.split(';').filter(l => l.trim().startsWith('v_'));
            
            for (const line of lines) {
                const match = line.match(/v_(\w+)="(.*)"/);
                if (!match) continue;
                
                const fullCode = match[1];
                const stockCode = fullCode.replace(/^(sz|sh|hk)/, '');
                const dataStr = match[2];
                
                if (!dataStr) {
                    results[stockCode] = { code: stockCode, name: '', zdf: null };
                    continue;
                }
                
                const parts = dataStr.split('~');
                if (parts.length >= 5) {
                    // 腾讯财经字段说明：
                    // parts[1] = 股票名称, parts[3] = 当前价格, parts[4] = 昨收价格
                    // parts[32] = 涨跌幅(%)（仅兜底，优先用价格计算保证准确）
                    const stockName = parts[1] || '';
                    const currentPrice = parseFloat(parts[3]);
                    const prevClose = parseFloat(parts[4]);
                    let zdf = null;
                    if (prevClose > 0 && !isNaN(currentPrice)) {
                        zdf = Math.round(((currentPrice - prevClose) / prevClose * 100) * 100) / 100;
                    } else if (parts.length >= 33) {
                        const rawZdf = parseFloat(parts[32]);
                        if (!isNaN(rawZdf)) zdf = rawZdf;
                    }

                    results[stockCode] = {
                        code: stockCode,
                        name: stockName,
                        zdf
                    };
                }
            }
        }

        // 填充未获取到的股票
        for (const code of codeList) {
            if (!results[code]) results[code] = { code, name: '', zdf: null };
        }

        res.json({ success: true, data: results });
    } catch (err) {
        console.error('[api/stock/quote]', err.message);
        res.status(500).json({ success: false, message: '行情获取失败: ' + err.message });
    }
});

app.get('/api/fund/holdings/debug', async (req, res) => {
    const code = String(req.query.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ success: false, message: '请输入正确的6位基金代码' });
    }
    try {
        const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=&rt=${Date.now()}`;
        const { status, text } = await requestGet(url, `https://fundf10.eastmoney.com/ccmx_${code}.html`);
        if (status !== 200 || !text) {
            return res.status(502).json({ success: false, message: `上游返回异常 (HTTP ${status})` });
        }
        const m = text.match(/apidata\s*=\s*(\{[\s\S]*?\})\s*;?/);
        if (!m) return res.json({ success: false, message: '未找到 apidata' });
        const apidata = S.safeEval(m[1]);
        if (!apidata) return res.json({ success: false, message: 'apidata 解析失败' });

        const html = apidata.content || '';
        const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
        const tableInfo = [];
        for (let i = 0; i < Math.min(tables.length, 2); i++) {
            const tableHtml = tables[i];
            const headerRowMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
            let headers = [];
            if (headerRowMatch) {
                headers = [...headerRowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => S.stripTags(m[1]));
            }
            const tbodyMatch = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i);
            const tbodyHtml = tbodyMatch ? tbodyMatch[0] : tableHtml;
            const trs = tbodyHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
            const sampleData = [];
            for (let j = 0; j < Math.min(trs.length, 3); j++) {
                const cells = [...trs[j].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => S.stripTags(m[1]));
                sampleData.push(cells);
            }
            tableInfo.push({ tableIndex: i, headers, sampleData });
        }
        res.json({ success: true, tableCount: tables.length, tables: tableInfo });
    } catch (err) {
        console.error('[api/fund/holdings/debug]', err.message);
        res.status(500).json({ success: false, message: '调试失败: ' + err.message });
    }
});

app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║        FundScope - 基金持仓分析平台 (Node.js 后端)             ║
╠══════════════════════════════════════════════════════════════╣
║  访问地址:  http://localhost:${String(PORT).padEnd(37)}║
║  本地测试:  http://127.0.0.1:${String(PORT).padEnd(36)}║
╚══════════════════════════════════════════════════════════════╝
`);
    console.log(`[INFO] Node 版本: ${process.version}  |  工作目录: ${__dirname}`);
});
