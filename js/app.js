/* ===== 基金持仓展示系统 ===== */

let pieChart = null;
let barChart = null;
let currentFundCode = '';
let currentHoldingData = null;
let fundConfigList = [];
let stockQuotesCache = {};
let pieResizeObserver = null;

/* ===== 部署模式检测 ===== */
const IS_STATIC = (() => {
    const host = window.location.hostname;
    if (host.endsWith('.github.io')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return false;
    if (host === 'wuhuajin.com' || host === 'www.wuhuajin.com') return false;
    return window.location.protocol === 'https:' && !window.location.port;
})();

const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?url='
];

async function corsFetch(url) {
    for (const proxy of CORS_PROXIES) {
        try {
            const res = await fetch(proxy + encodeURIComponent(url));
            if (res.ok) return res;
        } catch (e) { continue; }
    }
    throw new Error('网络请求失败（CORS代理不可用）');
}

// 解析函数从 js/shared.js 共享模块引入（FundShared.*）
const S = FundShared;

/* ===== 工具函数 ===== */

async function request(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Accept': 'application/json', ...options.headers },
        ...options
    });
    let payload;
    try { payload = await res.json(); }
    catch (e) { payload = null; }
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        if (payload && payload.message) msg = payload.message;
        throw new Error(msg);
    }
    if (payload && typeof payload === 'object' && 'success' in payload && !payload.success) {
        throw new Error(payload.message || '请求失败');
    }
    return payload;
}

function fetchFundConfig() {
    if (IS_STATIC) {
        return fetch('data.json').then(res => res.json()).then(json => ({ success: true, funds: json.funds || [] }));
    }
    return request('api/funds/config');
}

async function fetchFundInfo(fundCode) {
    if (IS_STATIC) {
        const url = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?v=${Date.now()}`;
        const res = await corsFetch(url);
        const text = await res.text();
        const data = S.parseFundInfo(text, fundCode);
        if (!data) throw new Error('未解析到基金数据');
        return { success: true, data };
    }
    return request(`api/fund/info?code=${encodeURIComponent(fundCode)}`);
}

async function fetchFundHoldings(fundCode) {
    if (IS_STATIC) {
        const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${fundCode}&topline=10&year=&month=&rt=${Date.now()}`;
        const res = await corsFetch(url);
        const text = await res.text();
        const data = S.parseHoldings(text, fundCode);
        if (!data || !data.data || !data.data.length) throw new Error('未获取到持仓数据');
        return { success: true, data };
    }
    return request(`api/fund/holdings?code=${encodeURIComponent(fundCode)}`);
}

async function fetchStockQuotes(codes) {
    if (!codes || !codes.length) return Promise.resolve({});
    if (IS_STATIC) {
        const sinaCodes = codes.map(code => {
            const market = S.getMarketByCode(code);
            const prefix = market === 0 ? 'sz' : (market === 1 ? 'sh' : 'hk');
            return `${prefix}${code}`;
        }).join(',');
        const url = `https://hq.sinajs.cn/list=${sinaCodes}`;
        const res = await corsFetch(url);
        const buffer = await res.arrayBuffer();
        const text = new TextDecoder('gbk').decode(buffer);
        const results = {};
        const lines = text.split(';').filter(l => l.trim().startsWith('var'));
        for (const line of lines) {
            const match = line.match(/var hq_str_(\w+)="(.*)"/);
            if (!match) continue;
            const stockCode = match[1].replace(/^(sz|sh|hk)/, '');
            const dataStr = match[2];
            if (!dataStr) { results[stockCode] = { code: stockCode, name: '', zdf: null }; continue; }
            const parts = dataStr.split(',');
            if (parts.length >= 4) {
                const prevClose = parseFloat(parts[2]);
                const currentPrice = parseFloat(parts[3]);
                let zdf = null;
                if (prevClose > 0 && !isNaN(currentPrice)) {
                    zdf = ((currentPrice - prevClose) / prevClose) * 100;
                    zdf = Math.round(zdf * 100) / 100;
                }
                results[stockCode] = { code: stockCode, name: parts[0] || '', zdf };
            }
        }
        for (const code of codes) {
            if (!results[code]) results[code] = { code, name: '', zdf: null };
        }
        return { success: true, data: results };
    }
    return request(`api/stock/quote?codes=${codes.join(',')}`);
}

/* ===== 数据处理 ===== */

function parseFundInfo(data) {
    if (!data) throw new Error('基金代码不存在或数据格式错误');
    const d = data.data || data;
    if (!d || (!d.fundcode && !d.name)) throw new Error('基金代码不存在，请检查后重试');
    const chg = d.gszzl !== undefined && d.gszzl !== null && d.gszzl !== '' ? parseFloat(d.gszzl) : NaN;
    const syl1n = d.syl_1n !== undefined && d.syl_1n !== null && d.syl_1n !== '' ? parseFloat(d.syl_1n) : NaN;
    return {
        code: d.fundcode || '',
        name: d.name || '',
        netValue: d.dwjz || d.gsz || '--',
        netValueDate: d.jzrq || (d.gztime ? String(d.gztime).split(' ')[0] : '--'),
        dayChange: isNaN(chg) ? '--' : ((chg > 0 ? '+' : '') + chg.toFixed(2) + '%'),
        dayChangeNum: isNaN(chg) ? 0 : chg,
        syl1n: isNaN(syl1n) ? '--' : ((syl1n > 0 ? '+' : '') + syl1n.toFixed(2) + '%'),
        syl1nNum: isNaN(syl1n) ? 0 : syl1n,
        manager: d.manager || '--'
    };
}

function parseHoldingData(apidata, fundCode) {
    if (!apidata) throw new Error('未获取到持仓数据');
    const d = apidata.data || apidata;
    const result = {
        fundInfo: {},
        stockList: [],
        updateTime: ''
    };

    if (d.fundcode) {
        result.fundInfo.code = d.fundcode;
        result.fundInfo.name = d.fundname || '--';
        result.fundInfo.type = d.fundtype || '--';
        result.fundInfo.company = d.fundcompnay || d.fundcompany || '--';
    }

    if (d.data && Array.isArray(d.data)) {
        result.stockList = d.data.map(item => {
            let zdfDisplay = '--';
            let zdfNum = null;
            if (item.zdf !== null && item.zdf !== undefined && !isNaN(item.zdf)) {
                zdfNum = parseFloat(item.zdf);
                zdfDisplay = (zdfNum > 0 ? '+' : '') + zdfNum.toFixed(2) + '%';
            }

            return {
                stockCode: item.scode || item.stockcode || '--',
                stockName: item.sname || item.stockname || '--',
                ratio: parseFloat(item.zfbl || item.ratio || 0),
                amount: parseFloat(item.zsc || item.amount || 0),
                shares: parseFloat(item.gsc || item.shares || 0),
                change: item.zdbj || item.change || '--',
                zdf: zdfDisplay,
                zdfNum: zdfNum
            };
        });
        result.stockList.sort((a, b) => b.ratio - a.ratio);
    }

    if (d.jzrq) {
        result.updateTime = d.jzrq;
    } else if (d.gztime) {
        result.updateTime = d.gztime;
    }

    return result;
}

/* ===== UI 渲染 ===== */

function showLoading() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('mainContent').classList.add('hidden');
}

function showError(message) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('errorState').classList.remove('hidden');
    document.getElementById('mainContent').classList.add('hidden');
    document.getElementById('errorText').textContent = message || '获取数据失败';
}

function showMainContent() {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
}

function renderFundInfo(info, holdingInfo) {
    const finalInfo = { ...info, ...holdingInfo.fundInfo };

    document.getElementById('fundName').textContent = finalInfo.name || '--';
    document.getElementById('fundCodeDisplay').textContent = finalInfo.code || '--';
    document.getElementById('netValue').textContent = finalInfo.netValue || '--';

    const dayChangeEl = document.getElementById('dayChange');
    dayChangeEl.textContent = finalInfo.dayChange || '--';
    dayChangeEl.classList.remove('up', 'down');
    if (finalInfo.dayChangeNum > 0) dayChangeEl.classList.add('up');
    else if (finalInfo.dayChangeNum < 0) dayChangeEl.classList.add('down');

    const syl1nEl = document.getElementById('syl1n');
    syl1nEl.textContent = finalInfo.syl1n || '--';
    syl1nEl.classList.remove('up', 'down');
    if (finalInfo.syl1nNum > 0) syl1nEl.classList.add('up');
    else if (finalInfo.syl1nNum < 0) syl1nEl.classList.add('down');

    document.getElementById('manager').textContent = finalInfo.manager || '--';

    document.getElementById('updateTime').textContent =
        holdingInfo.updateTime || finalInfo.netValueDate || '--';
}

const CHART_TOOLTIP = {
    backgroundColor: 'rgba(10, 22, 40, 0.9)',
    borderColor: 'rgba(212, 175, 55, 0.3)',
    textStyle: { color: '#e8ecf4', fontSize: 12 }
};

function renderPieChart(stockList) {
    const chartDom = document.getElementById('pieChart');
    if (!pieChart) pieChart = echarts.init(chartDom);

    const data = stockList.slice(0, 10).map(item => ({
        name: item.stockName,
        value: item.ratio
    }));

    const option = {
        tooltip: {
            trigger: 'item',
            formatter: '{b}<br/>持仓占比: {c}%<br/>占净值比例: {d}%',
            ...CHART_TOOLTIP
        },
        color: [
            '#d4af37', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b',
            '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#6366f1'
        ],
        series: [{
            name: '持仓占比',
            type: 'pie',
            radius: ['40%', '70%'],
            center: ['50%', '50%'],
            itemStyle: {
                borderRadius: 5,
                borderColor: 'rgba(10, 22, 40, 0.95)',
                borderWidth: 2
            },
            label: {
                show: true,
                position: 'outside',
                color: '#b8c5d8',
                fontSize: 11,
                formatter: '{b}  {c}%'
            },
            labelLine: {
                show: true,
                length: 12,
                length2: 10,
                smooth: false,
                lineStyle: {
                    color: 'rgba(139, 155, 180, 0.45)',
                    width: 1
                }
            },
            labelLayout: {
                hideOverlap: true,
                moveToEdge: true
            },
            emphasis: {
                scale: true,
                scaleSize: 5,
                label: { show: true, fontSize: 13, fontWeight: 'bold', color: '#e8ecf4' },
                itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' }
            },
            data
        }]
    };

    pieChart.setOption(option, true);
    pieChart.resize();
}

function renderBarChart(stockList) {
    const chartDom = document.getElementById('barChart');
    if (!barChart) barChart = echarts.init(chartDom);

    const containerW = chartDom.offsetWidth;
    const containerH = chartDom.offsetHeight;

    const top10 = stockList.slice(0, 10).reverse();
    const names = top10.map(item => item.stockName);
    const amounts = top10.map(item => item.amount);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '12px sans-serif';
    let maxNameWidth = 0;
    names.forEach(n => {
        const w = ctx.measureText(n).width;
        if (w > maxNameWidth) maxNameWidth = w;
    });
    ctx.font = '11px sans-serif';
    let maxLabelWidth = 0;
    amounts.forEach(v => {
        const text = v >= 10000 ? (v / 10000).toFixed(2) + '亿' : v.toFixed(0);
        const w = ctx.measureText(text).width;
        if (w > maxLabelWidth) maxLabelWidth = w;
    });

    const yLabelPad = 18;
    const yLabelWidth = Math.ceil(maxNameWidth) + 6;
    const gridLeft = yLabelWidth + yLabelPad;
    const gridRight = Math.ceil(maxLabelWidth) + 24;

    const option = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: function (params) {
                const item = params[0];
                const stock = top10[item.dataIndex];
                return `${item.name}<br/>持仓市值: ${item.value.toFixed(2)}万元<br/>持仓比例: ${stock.ratio}%`;
            },
            ...CHART_TOOLTIP
        },
        grid: {
            top: 10,
            bottom: 32,
            left: gridLeft,
            right: gridRight,
            containLabel: false
        },
        xAxis: {
            type: 'value',
            axisLabel: {
                color: '#8b9bb4',
                fontSize: 10,
                hideOverlap: true,
                margin: 8,
                formatter: function(val) {
                    return val >= 10000 ? (val / 10000).toFixed(0) + '亿' : val;
                }
            },
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: 'rgba(212, 175, 55, 0.08)' } }
        },
        yAxis: {
            type: 'category',
            data: names,
            axisLabel: {
                color: '#8b9bb4',
                fontSize: 12,
                interval: 0,
                margin: 10,
                width: yLabelWidth,
                overflow: 'truncate'
            },
            axisLine: { lineStyle: { color: 'rgba(212, 175, 55, 0.2)' } },
            axisTick: { show: false }
        },
        series: [{
            name: '持仓市值',
            type: 'bar',
            data: amounts,
            barWidth: '58%',
            itemStyle: {
                borderRadius: [0, 4, 4, 0],
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: 'rgba(212, 175, 55, 0.3)' },
                    { offset: 1, color: '#d4af37' }
                ])
            },
            emphasis: {
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: 'rgba(240, 208, 96, 0.4)' },
                        { offset: 1, color: '#f0d060' }
                    ])
                }
            },
            label: {
                show: true,
                position: 'right',
                color: '#d4af37',
                fontSize: 11,
                fontWeight: 500,
                distance: 6,
                formatter: function(params) {
                    return params.value >= 10000 ? (params.value / 10000).toFixed(2) + '亿' : params.value.toFixed(0);
                }
            }
        }]
    };

    barChart.setOption(option, true);
    barChart.resize();
}

function renderCharts(stockList) {
    if (stockList && stockList.length > 0) {
        renderPieChart(stockList);
        renderBarChart(stockList);
    }
}

function renderTable(stockList, sortBy = 'ratio') {
    const sorted = [...stockList].sort((a, b) => {
        switch (sortBy) {
            case 'amount': return b.amount - a.amount;
            case 'name': return a.stockName.localeCompare(b.stockName, 'zh-CN');
            case 'ratio':
            default: return b.ratio - a.ratio;
        }
    });

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = sorted.map((item, index) => {
        // 涨跌幅颜色
        const zdfClass = item.zdfNum !== null && item.zdfNum !== undefined
            ? (item.zdfNum > 0 ? 'up' : (item.zdfNum < 0 ? 'down' : ''))
            : '';

        // 增减持显示
        let changeHtml = '--';
        if (item.change === '新增') {
            changeHtml = '<span class="new-tag">新增</span>';
        } else if (item.change && item.change !== '--') {
            const changeNum = parseFloat(item.change);
            if (!isNaN(changeNum)) {
                const changeClass = changeNum > 0 ? 'up' : (changeNum < 0 ? 'down' : '');
                changeHtml = `<span class="${changeClass}">${item.change}</span>`;
            } else {
                changeHtml = item.change;
            }
        }

        return `
            <tr>
                <td>${index + 1}</td>
                <td>${item.stockName}</td>
                <td>${item.stockCode}</td>
                <td class="zdf-cell ${zdfClass}">${item.zdf || '--'}</td>
                <td>${item.ratio.toFixed(2)}%</td>
                <td>${item.amount.toFixed(2)}</td>
                <td>${item.shares.toFixed(2)}</td>
                <td>${changeHtml}</td>
            </tr>
        `;
    }).join('');

    const totalRatio = sorted.reduce((sum, item) => sum + item.ratio, 0);
    const totalAmount = sorted.reduce((sum, item) => sum + item.amount, 0);
    document.getElementById('totalRatio').textContent = totalRatio.toFixed(2) + '%';
    document.getElementById('totalAmount').textContent = totalAmount.toFixed(2) + '万元';
}

/* ===== Combo Box ===== */

let _filterList = null; // 从 initComboBox 中暴露，供 DOMContentLoaded 调用

function initComboBox() {
    const input = document.getElementById('fundCode');
    const dropdown = document.getElementById('fundDropdown');
    const clearBtn = document.getElementById('clearBtn');
    let activeIndex = -1;
    let filteredList = [];
    let isSelectingFromDropdown = false;
    let displayCount = 8;
    const PAGE_SIZE = 8;

    function toggleClearIcon() {
        if (input.value.trim()) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }

    clearBtn.addEventListener('click', () => {
        input.value = '';
        toggleClearIcon();
        input.focus();
        filterList('');
    });

    function renderDropdown(list, keyword = '') {
        if (!list.length) {
            dropdown.innerHTML = '<div class="fund-dropdown-empty">暂无匹配的基金</div>';
            dropdown.style.maxHeight = 'none';
            dropdown.classList.remove('hidden');
            return;
        }

        const visibleItems = list.slice(0, displayCount);
        const hasMore = displayCount < list.length;

        // 先清除高度限制
        dropdown.style.maxHeight = 'none';

        dropdown.innerHTML = visibleItems.map((fund, idx) => {
            const nameHighlight = keyword
                ? fund.name.replace(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<span class="highlight">${m}</span>`)
                : fund.name;
            const codeHighlight = keyword && /^\d+$/.test(keyword)
                ? fund.code.replace(new RegExp(keyword, 'g'), m => `<span class="highlight">${m}</span>`)
                : fund.code;
            return `
                <div class="fund-dropdown-item ${idx === activeIndex ? 'active' : ''}" 
                     data-code="${fund.code}" data-name="${fund.name}" data-index="${idx}">
                    <span class="fund-dropdown-name">${nameHighlight}</span>
                    <span class="fund-dropdown-code">${codeHighlight}</span>
                </div>
            `;
        }).join('');

        // 显示加载更多提示
        if (hasMore) {
            dropdown.innerHTML += `<div class="fund-dropdown-load-more">下拉加载更多...</div>`;
        }

        // 显示下拉列表
        dropdown.classList.remove('hidden');

        // 同步强制布局，测量自然高度
        const naturalHeight = dropdown.scrollHeight;
        const fallbackHeight = visibleItems.length * 49 + (hasMore ? 40 : 0) + 12;
        const actualHeight = naturalHeight > 0 ? naturalHeight : fallbackHeight;
        const capHeight = 650;
        dropdown.style.maxHeight = Math.min(actualHeight, capHeight) + 'px';

        dropdown.querySelectorAll('.fund-dropdown-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const code = item.dataset.code;
                const name = item.dataset.name;
                isSelectingFromDropdown = true;
                input.value = name;
                toggleClearIcon();
                dropdown.classList.add('hidden');
                activeIndex = -1;
                queryFund(code);
            });
        });
    }

    // 滚动触底加载更多
    dropdown.addEventListener('scroll', () => {
        const scrollBottom = dropdown.scrollTop + dropdown.clientHeight;
        const threshold = 20;
        if (scrollBottom >= dropdown.scrollHeight - threshold && displayCount < filteredList.length) {
            displayCount = Math.min(displayCount + PAGE_SIZE, filteredList.length);
            // 保留当前滚动位置，追加渲染
            const prevScrollTop = dropdown.scrollTop;
            renderDropdown(filteredList, input.value.trim());
            dropdown.scrollTop = prevScrollTop;
        }
    });

    function filterList(keyword) {
        if (!keyword) {
            filteredList = fundConfigList.slice();
        } else {
            const kw = keyword.toLowerCase();
            filteredList = fundConfigList.filter(f =>
                f.name.toLowerCase().includes(kw) || f.code.includes(kw)
            );
        }
        displayCount = PAGE_SIZE;
        activeIndex = filteredList.length ? 0 : -1;
        renderDropdown(filteredList, keyword);
    }
    _filterList = filterList; // 暴露给外部调用

    input.addEventListener('input', () => {
        if (isSelectingFromDropdown) {
            isSelectingFromDropdown = false;
            return;
        }
        toggleClearIcon();
        const val = input.value.trim();
        filterList(val);
    });

    input.addEventListener('focus', () => {
        toggleClearIcon();
        filterList(input.value.trim());
    });

    // 鼠标点击也触发显示（确保点击输入框时必然显示下拉）
    document.querySelector('.combobox-wrapper').addEventListener('click', (e) => {
        if (e.target.classList.contains('clear-icon') || e.target.closest('.clear-icon')) {
            return; // 清空按钮点击由其自身处理
        }
        input.focus();
        toggleClearIcon();
        filterList(input.value.trim());
    });

    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.fund-dropdown-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeIndex < items.length - 1) activeIndex++;
            else activeIndex = 0;
            items.forEach((item, idx) => item.classList.toggle('active', idx === activeIndex));
            if (activeIndex >= 0 && items[activeIndex]) {
                items[activeIndex].scrollIntoView({ block: 'nearest' });
                input.value = items[activeIndex].dataset.name;
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeIndex > 0) activeIndex--;
            else activeIndex = items.length - 1;
            items.forEach((item, idx) => item.classList.toggle('active', idx === activeIndex));
            if (activeIndex >= 0 && items[activeIndex]) {
                items[activeIndex].scrollIntoView({ block: 'nearest' });
                input.value = items[activeIndex].dataset.name;
            }
        } else if (e.key === 'Enter') {
            if (!dropdown.classList.contains('hidden') && activeIndex >= 0) {
                e.preventDefault();
                if (items[activeIndex]) {
                    const code = items[activeIndex].dataset.code;
                    const name = items[activeIndex].dataset.name;
                    input.value = name;
                    dropdown.classList.add('hidden');
                    queryFund(code);
                }
            } else {
                const code = resolveCode(input.value);
                if (/^\d{6}$/.test(code)) {
                    dropdown.classList.add('hidden');
                    queryFund(code);
                }
            }
        } else if (e.key === 'Escape') {
            dropdown.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.combobox-wrapper')) {
            dropdown.classList.add('hidden');
        }
    });
}

/* ===== 主流程 ===== */

async function queryFund(fundCode) {
    if (!fundCode || !/^\d{6}$/.test(fundCode)) {
        showError('请输入正确的6位基金代码');
        return;
    }

    currentFundCode = fundCode;
    showLoading();

    try {
        const [infoRes, holdingRes] = await Promise.all([
            fetchFundInfo(fundCode).catch(err => {
                console.warn('获取基金基本信息失败:', err);
                return null;
            }),
            fetchFundHoldings(fundCode).catch(err => {
                console.warn('获取持仓数据失败:', err);
                return null;
            })
        ]);

        let parsedInfo = {};
        if (infoRes) {
            try { parsedInfo = parseFundInfo(infoRes); }
            catch (e) { console.warn('解析基本信息失败:', e); }
        }

        let parsedHolding = { fundInfo: parsedInfo, stockList: [], updateTime: parsedInfo.netValueDate };
        if (holdingRes) {
            try { parsedHolding = parseHoldingData(holdingRes, fundCode); }
            catch (e) { console.warn('解析持仓数据失败:', e); }
        }

        if (!parsedInfo.code && parsedHolding.stockList.length === 0) {
            throw new Error('未获取到任何数据，请检查基金代码是否正确');
        }

        // 获取股票实时行情
        if (parsedHolding.stockList.length > 0) {
            const stockCodes = parsedHolding.stockList.map(s => s.stockCode);
            try {
                const quoteRes = await fetchStockQuotes(stockCodes);
                if (quoteRes && quoteRes.data) {
                    stockQuotesCache = quoteRes.data;
                    // 用实时行情覆盖涨跌幅
                    parsedHolding.stockList.forEach(item => {
                        const quote = stockQuotesCache[item.stockCode];
                        if (quote && quote.zdf !== null && quote.zdf !== undefined && !isNaN(quote.zdf)) {
                            item.zdfNum = quote.zdf;
                            item.zdf = (quote.zdf > 0 ? '+' : '') + quote.zdf.toFixed(2) + '%';
                        }
                    });
                }
            } catch (e) {
                console.warn('获取股票行情失败，使用持仓接口返回的涨跌幅:', e);
            }
        }

        currentHoldingData = parsedHolding;
        renderFundInfo(parsedInfo, parsedHolding);

        if (parsedHolding.stockList.length > 0) {
            renderCharts(parsedHolding.stockList);
            renderTable(parsedHolding.stockList);
        } else {
            const emptyHtml = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5a6b82;font-size:14px;">暂无持仓数据</div>';
            document.getElementById('pieChart').innerHTML = emptyHtml;
            document.getElementById('barChart').innerHTML = emptyHtml;
            document.getElementById('tableBody').innerHTML =
                '<tr><td colspan="8" style="text-align:center;padding:40px;color:#5a6b82;">暂无持仓数据</td></tr>';
            document.getElementById('totalRatio').textContent = '--';
            document.getElementById('totalAmount').textContent = '--';
        }

        showMainContent();
        saveSearchHistory(fundCode, parsedInfo);

    } catch (error) {
        console.error('查询失败:', error);
        showError(error.message || '获取数据失败，请稍后重试');
    }
}

function saveSearchHistory(fundCode, info) {
    try {
        const history = JSON.parse(localStorage.getItem('fundHistory') || '[]');
        const entry = {
            code: fundCode,
            name: info.name || '--',
            time: new Date().toISOString()
        };
        const filtered = history.filter(item => item.code !== fundCode);
        filtered.unshift(entry);
        localStorage.setItem('fundHistory', JSON.stringify(filtered.slice(0, 10)));
    } catch (e) {
        console.warn('保存历史失败:', e);
    }
}

/* ===== 事件绑定 ===== */

function resolveCode(displayText) {
    if (/^\d{6}$/.test(displayText)) return displayText;
    const found = fundConfigList.find(f => f.name === displayText.trim());
    return found ? found.code : displayText.trim();
}

function initEvents() {
    const searchBtn = document.getElementById('searchBtn');
    const fundCodeInput = document.getElementById('fundCode');

    searchBtn.addEventListener('click', () => {
        const displayText = fundCodeInput.value.trim();
        const code = resolveCode(displayText);
        document.getElementById('fundDropdown').classList.add('hidden');
        queryFund(code);
    });

    fundCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const displayText = fundCodeInput.value.trim();
            const code = resolveCode(displayText);
            queryFund(code);
        }
    });

    document.getElementById('retryBtn').addEventListener('click', () => {
        if (currentFundCode) {
            queryFund(currentFundCode);
        } else {
            showError('请先输入基金代码');
        }
    });

    document.getElementById('sortSelect').addEventListener('change', (e) => {
        if (currentHoldingData && currentHoldingData.stockList.length > 0) {
            renderTable(currentHoldingData.stockList, e.target.value);
        }
    });

    if (pieResizeObserver) pieResizeObserver.disconnect();

    const chartDoms = [document.getElementById('pieChart'), document.getElementById('barChart')];
    pieResizeObserver = new ResizeObserver(() => {
        if (currentHoldingData && currentHoldingData.stockList.length > 0) {
            renderCharts(currentHoldingData.stockList);
        }
    });
    chartDoms.forEach(dom => dom && pieResizeObserver.observe(dom));
}

/* ===== 页面加载完成后初始化 ===== */

document.addEventListener('DOMContentLoaded', async () => {
    initEvents();
    initComboBox();

    const input = document.getElementById('fundCode');

    // 加载基金配置
    try {
        const configRes = await fetchFundConfig();
        if (configRes && configRes.funds && configRes.funds.length) {
            fundConfigList = configRes.funds;
        }
    } catch (e) {
        console.warn('加载基金配置失败:', e);
    }

    // 如果配置加载后输入框已获得焦点且为空，立即显示下拉列表
    if (document.activeElement === input && !input.value.trim() && fundConfigList.length && _filterList) {
        _filterList('');
    }

    // 初始化默认值 - 默认展示 data.json 中的第一项
    const defaultFund = fundConfigList.length > 0 ? fundConfigList[0] : { code: '000001', name: '' };
    input.value = defaultFund.name || defaultFund.code;
    queryFund(defaultFund.code);

    // 初始化完成后根据内容更新清空图标状态
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        if (input.value.trim()) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
});
