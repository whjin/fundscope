app.get('/api/stock/quote', async (req, res) => {
    const codes = String(req.query.codes || '').trim();
    if (!codes) return res.status(400).json({ success: false, message: '请提供股票代码' });
    const codeList = codes.split(',').map(c => c.trim()).filter(c => /^\d{5,6}$/.test(c));
    if (!codeList.length) return res.status(400).json({ success: false, message: '股票代码格式错误' });

    try {
        const results = {};
        
        // 转换为东方财富的 secid 格式
        // 0=深市(0/3开头), 1=沪市(6开头), 116=港股(5位)
        const secids = codeList.map(code => {
            const market = S.getMarketByCode(code);
            if (market === 2) return `116.${code}`; // 港股
            const prefix = market === 0 ? '0' : '1'; // 0=深市, 1=沪市
            return `${prefix}.${code}`;
        }).join(',');

        const { status, text } = await requestGet(
            `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f12,f14,f2,f3`,
            'https://quote.eastmoney.com/'
        );

        if (status === 200 && text) {
            try {
                const data = JSON.parse(text);
                if (data && data.data && data.data.diff) {
                    for (const item of data.data.diff) {
                        const stockCode = item.f12;
                        const stockName = item.f14 || '';
                        // f2: 现价（单位：精确到厘，除以1000得到元）
                        // f3: 涨跌幅（单位：百分点*100，除以100得到百分比）
                        const price = item.f2 && item.f2 !== '-' ? item.f2 / 1000 : null;
                        const zdf = item.f3 && item.f3 !== '-' ? item.f3 / 100 : null;
                        
                        results[stockCode] = {
                            code: stockCode,
                            name: stockName,
                            zdf: zdf
                        };
                    }
                }
            } catch (parseErr) {
                console.error('[api/stock/quote] JSON parse error:', parseErr.message);
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
