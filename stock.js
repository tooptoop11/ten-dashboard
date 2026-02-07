// TEN Dashboard - Live Stock API
// Source: Yahoo Finance (TTE.PA - TotalEnergies SE)

exports.handler = async (event, context) => {
  const SYMBOL = 'TTE.PA';

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}?interval=1d&range=5d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Yahoo Finance returned ${response.status}`);
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];

    if (!result) {
      throw new Error('No data from Yahoo Finance');
    }

    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice;
    const previousClose = meta.previousClose || meta.chartPreviousClose;
    const change = currentPrice - previousClose;
    const changePercent = (change / previousClose) * 100;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=15'
      },
      body: JSON.stringify({
        symbol: SYMBOL,
        name: 'TotalEnergies SE',
        price: currentPrice.toFixed(2),
        previousClose: previousClose.toFixed(2),
        change: change.toFixed(2),
        changePercent: changePercent.toFixed(2),
        currency: meta.currency || 'EUR',
        marketState: meta.marketState,
        dayHigh: meta.regularMarketDayHigh?.toFixed(2),
        dayLow: meta.regularMarketDayLow?.toFixed(2),
        volume: meta.regularMarketVolume,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh?.toFixed(2),
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow?.toFixed(2),
        lastUpdate: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('Stock fetch error:', error);

    // Fallback data
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        symbol: SYMBOL,
        name: 'TotalEnergies SE',
        price: '60.14',
        previousClose: '61.15',
        change: '-1.01',
        changePercent: '-1.65',
        currency: 'EUR',
        marketState: 'CLOSED',
        fallback: true,
        error: error.message,
        lastUpdate: new Date().toISOString()
      })
    };
  }
};
