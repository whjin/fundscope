/**
 * 基金持仓解析 - 共享模块
 * 同时供 Node.js 后端 (require) 和浏览器前端 (script标签) 使用
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.FundShared = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {

    function safeEval(str) {
        if (typeof str !== 'string' || !str.trim()) return null;
        try { return JSON.parse(str); } catch (_) {
            try { return (new Function('return (' + str + ')'))(); }
            catch (e) { return null; }
        }
    }

    function findMatching(str, open, close) {
        let depth = 0, inStr = null, esc = false;
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === inStr) inStr = null;
                continue;
            }
            if (c === '"' || c === "'") { inStr = c; continue; }
            if (c === open) depth++;
            else if (c === close) { depth--; if (depth === 0) return i; }
        }
        return -1;
    }

    function extractVar(script, name) {
        if (!script) return null;
        const anchor = new RegExp(`var\\s+${name}\\s*=\\s*`);
        const idx = script.search(anchor);
        if (idx < 0) return null;
        const start = idx + script.match(anchor)[0].length;
        const rest = script.slice(start);
        const firstChar = rest.trimStart()[0];
        let end;
        if (firstChar === '{') end = findMatching(rest, '{', '}') + 1;
        else if (firstChar === '[') end = findMatching(rest, '[', ']') + 1;
        else if (firstChar === '"' || firstChar === "'") {
            const q = firstChar;
            let i = 1, esc2 = false;
            while (i < rest.length) {
                const c = rest[i];
                if (esc2) esc2 = false;
                else if (c === '\\') esc2 = true;
                else if (c === q) { end = i + 1; break; }
                i++;
            }
            if (end === undefined) return null;
        } else {
            const sm = rest.search(/;/);
            end = sm >= 0 ? sm : rest.length;
        }
        return safeEval(rest.slice(0, end));
    }

    function extractStringVar(script, name) {
        if (!script) return '';
        const re = new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`);
        const m = script.match(re);
        return m ? m[1] : '';
    }

    function extractNumberVar(script, name) {
        if (!script) return '';
        const re = new RegExp(`var\\s+${name}\\s*=\\s*"([\\-\\d.]+)"`);
        const m = script.match(re);
        return m ? m[1] : '';
    }

    function stripTags(s) {
        return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function toNumber(v) {
        if (v === null || v === undefined || v === '') return 0;
        let s = String(v).replace(/,/g, '').replace(/%/g, '').trim();
        if (s === '' || s === '--') return 0;
        const n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    }

    function buildColumnMap(headerCells) {
        const map = { code: -1, name: -1, ratio: -1, shares: -1, amount: -1, zdf: -1, zj: -1 };
        if (!headerCells.length) return map;
        for (let i = 0; i < headerCells.length; i++) {
            const cell = headerCells[i];
            if (cell.includes('股票代码') || cell === '代码') map.code = i;
            else if (cell.includes('股票名称') || cell === '名称') map.name = i;
            else if (cell.includes('占比') || cell.includes('比例')) map.ratio = i;
            else if (cell.includes('持股数量') || cell.includes('持股数') || cell.includes('股数')) map.shares = i;
            else if (cell.includes('市值') || cell.includes('金额')) map.amount = i;
            else if (cell.includes('涨跌') && !cell.includes('增减')) map.zdf = i;
            else if (cell === '增减' || cell.includes('增减')) map.zj = i;
        }
        return map;
    }

    function getMarketByCode(code) {
        if (!code) return 0;
        if (/^\d{5}$/.test(code)) return 2; // hk
        const prefix = code.charAt(0);
        if (prefix === '6') return 1;  // sh
        if (prefix === '0' || prefix === '3') return 0; // sz
        return 0;
    }

    function parseFundInfo(scriptText, code) {
        if (!scriptText) return null;
        const name = extractStringVar(scriptText, 'fS_name') || '';
        const cd = extractStringVar(scriptText, 'fS_code') || code;
        if (!name && !cd) return null;
        const netWorthArr = extractVar(scriptText, 'Data_netWorthTrend');
        let dwjz = '', jzrq = '', gszzl = '';
        let change = null;
        if (Array.isArray(netWorthArr) && netWorthArr.length) {
            const lastNet = netWorthArr[netWorthArr.length - 1];
            const prevNet = netWorthArr.length >= 2 ? netWorthArr[netWorthArr.length - 2] : null;
            if (lastNet) {
                dwjz = String(lastNet.y ?? '');
                const d = new Date(lastNet.x);
                jzrq = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
            if (prevNet && lastNet && prevNet.y > 0) {
                change = ((lastNet.y - prevNet.y) / prevNet.y) * 100;
                gszzl = change.toFixed(2);
            }
        }
        const managerArr = extractVar(scriptText, 'Data_currentFundManager');
        let manager = '';
        if (Array.isArray(managerArr) && managerArr.length) {
            manager = managerArr.map(m => (m && m.name) ? m.name : '').filter(Boolean).join('、');
        }
        return {
            fundcode: cd, name, jzrq, dwjz, gsz: dwjz, gszzl,
            gztime: jzrq ? (jzrq + ' 15:00') : '', manager,
            syl_1n: extractNumberVar(scriptText, 'syl_1n'),
            syl_6y: extractNumberVar(scriptText, 'syl_6y'),
            syl_3y: extractNumberVar(scriptText, 'syl_3y'),
            syl_1y: extractNumberVar(scriptText, 'syl_1y'),
            fund_sourceRate: extractStringVar(scriptText, 'fund_sourceRate'),
            fund_Rate: extractStringVar(scriptText, 'fund_Rate'),
            _rawChange: change
        };
    }

    function parseHoldings(apidataText, code) {
        if (!apidataText) return null;
        const m = apidataText.match(/apidata\s*=\s*(\{[\s\S]*?\})\s*;?/);
        const apidata = m ? safeEval(m[1]) : null;
        if (!apidata) return null;
        let html = apidata.content || '';
        let fundName = '', reportPeriod = '';
        const h4Match = html.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
        if (h4Match) {
            const title = stripTags(h4Match[1]);
            const yrIdx = title.search(/\d{4}年/);
            if (yrIdx > 0) {
                fundName = title.slice(0, yrIdx).trim();
                const rest = title.slice(yrIdx);
                const pm = rest.match(/^(\d{4}年.+?(?:季度|中期|年度))/);
                if (pm) reportPeriod = pm[1].trim();
            } else {
                fundName = title.replace(/(?:股票)?投资明细$/g, '').trim();
            }
        } else {
            const cap = html.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
            if (cap) fundName = stripTags(cap[1]);
        }
        const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
        const stockList = [];
        let totalAmount = 0, totalRatio = 0;
        const tableDataByCode = {};
        for (let tIdx = 0; tIdx < Math.min(tables.length, 2); tIdx++) {
            const tableHtml = tables[tIdx];
            const isLatest = tIdx === 0;
            const headerRowMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
            let headerCells = [];
            if (headerRowMatch) {
                headerCells = [...headerRowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => stripTags(m[1]));
            }
            let tbodyHtml = tableHtml;
            const tbMatch = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i);
            if (tbMatch) tbodyHtml = tbMatch[0];
            const trs = tbodyHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
            const colMap = buildColumnMap(headerCells);
            for (const tr of trs) {
                const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => stripTags(m[1]));
                if (!cells.length) continue;
                if (cells[0] === '序号' || cells[1] === '股票代码') continue;
                let codeStr = '', nameStr = '', ratioStr = '', sharesStr = '', amountStr = '';
                if (colMap.code >= 0) codeStr = cells[colMap.code] || '';
                if (colMap.name >= 0) nameStr = cells[colMap.name] || '';
                if (colMap.ratio >= 0) ratioStr = cells[colMap.ratio] || '';
                if (colMap.shares >= 0) sharesStr = cells[colMap.shares] || '';
                if (colMap.amount >= 0) amountStr = cells[colMap.amount] || '';
                if (!/^\d{5,6}$/.test(codeStr)) {
                    const stockCodeIdx = cells.findIndex(c => /^\d{5,6}$/.test(c));
                    if (stockCodeIdx >= 0) {
                        codeStr = cells[stockCodeIdx];
                        nameStr = cells[stockCodeIdx + 1] || '';
                    }
                }
                if (!/^\d{5,6}$/.test(codeStr)) continue;
                const ratio = toNumber(ratioStr);
                const amount = toNumber(amountStr);
                const shares = toNumber(sharesStr);
                if (!codeStr || !nameStr || (ratio === 0 && amount === 0)) continue;
                if (!tableDataByCode[codeStr]) tableDataByCode[codeStr] = {};
                tableDataByCode[codeStr][isLatest ? 'latest' : 'prev'] = {
                    scode: codeStr, sname: nameStr, zfbl: ratio, gsc: shares, zsc: amount
                };
            }
        }
        for (const codeStr of Object.keys(tableDataByCode)) {
            const latest = tableDataByCode[codeStr].latest;
            const prev = tableDataByCode[codeStr].prev;
            if (!latest) continue;
            let zj = '--';
            if (prev) {
                if (prev.gsc > 0) {
                    const changePct = ((latest.gsc - prev.gsc) / prev.gsc) * 100;
                    const rounded = Math.round(changePct * 100) / 100;
                    if (Math.abs(rounded) < 0.01) zj = '持平';
                    else zj = (rounded > 0 ? '+' : '') + rounded.toFixed(2) + '%';
                } else if (latest.gsc > 0) zj = '新增';
            } else zj = '新增';
            stockList.push({ scode: latest.scode, sname: latest.sname, zfbl: latest.zfbl, gsc: latest.gsc, zsc: latest.zsc, zdbj: zj, zdf: null });
            totalAmount += latest.zsc;
            totalRatio += latest.zfbl;
        }
        stockList.sort((a, b) => b.zfbl - a.zfbl);
        return { fundcode: code, fundname: fundName, jzrq: reportPeriod, data: stockList, _totalRatio: totalRatio, _totalAmount: totalAmount };
    }

    return {
        safeEval, findMatching, extractVar, extractStringVar, extractNumberVar,
        stripTags, toNumber, buildColumnMap, getMarketByCode,
        parseFundInfo, parseHoldings
    };
});
