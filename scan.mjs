// Node port of the day-trader-skill rules: trader-scanner (daily + ORB), trader-exit (long only, atr stop, 1R/2R),
// trader-budget (min of 4 limits), trader-news (Yahoo headline RSS). Output: picks.json
import fs from 'fs';
const BUDGET = +process.env.BUDGET || 10000, MAXLOSS = BUDGET * 0.01;
const CFG = { cash_buffer_pct: 10, max_position_pct: 75, max_order_usd: BUDGET * 0.8, min_price: 5, min_volume: 1e6 };
const U = ("NVDA AAPL MSFT AMZN META GOOGL TSLA AMD AVGO NFLX PLTR COIN MSTR SMCI MU INTC UBER SHOP CRM ORCL JPM BAC XOM CVX BA DIS PYPL SOFI RIVN HOOD SNOW ARM QCOM ANET CRWD PANW LLY UNH WMT COST " +
 "ADBE CSCO IBM TXN AMAT LRCX KLAC NOW INTU ABNB DASH SQ F GM T VZ KO PEP MCD NKE SBUX HD LOW TGT CVS PFE MRK ABBV JNJ BMY GS MS C WFC V MA AXP SCHW GE CAT DE HON LMT RTX CCL RCL UAL DAL AAL LUV PLUG NIO LCID SNAP PINS ROKU RBLX U TTD DDOG NET ZS MDB OKTA WDAY TEAM LYFT AFRM UPST MARA RIOT CLSK OXY SLB COP FCX NEM").split(" ");
const IN = "RELIANCE TCS HDFCBANK ICICIBANK INFY SBIN BHARTIARTL ITC LT AXISBANK KOTAKBANK HINDUNILVR BAJFINANCE MARUTI SUNPHARMA TATAMOTORS TATASTEEL NTPC POWERGRID ONGC COALINDIA ADANIENT ADANIPORTS WIPRO HCLTECH TECHM M%26M ASIANPAINT TITAN ULTRACEMCO JSWSTEEL HINDALCO BAJAJFINSV NESTLEIND DRREDDY CIPLA EICHERMOT HEROMOTOCO BPCL IOC GRASIM INDUSINDBK TRENT ETERNAL BEL HAL VEDL SAIL PNB BANKBARODA IRCTC DLF TATAPOWER IDEA YESBANK".split(" ").map(x => x + ".NS");
const hdr = { 'User-Agent': 'Mozilla/5.0' };
const get = async (t, i, r) => { for (const h of ['query2', 'query1']) { try { const j = await (await fetch(`https://${h}.finance.yahoo.com/v8/finance/chart/${t}?interval=${i}&range=${r}`, { headers: hdr })).json(); if (j.chart.result) return j.chart.result[0]; } catch {} } };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = x => Math.round(x * 100) / 100, down = x => Math.floor(x * 100 + 1e-9) / 100;
function rsi(c, n = 14) { let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; } g /= n; l /= n;
  const out = [l === 0 ? 100 : 100 - 100 / (1 + g / l)];
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); } return out; }
async function one(t) { try {
  const d = await get(t, '1d', '6mo'), m = await get(t, '5m', '5d'); const q = d.indicators.quote[0];
  const rows = d.timestamp.map((_, i) => ({ o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] })).filter(r => Object.values(r).every(x => x != null));
  const C = rows.map(r => r.c), L = rows.at(-1), P = rows.at(-2);
  const mk = t.endsWith('.NS') ? 'IN' : 'US';
  if (L.c < (mk === 'IN' ? 20 : CFG.min_price) || L.v < (mk === 'IN' ? 5e5 : CFG.min_volume)) return;
  const setups = [];
  if (L.c > Math.max(...C.slice(-21, -1))) setups.push('20-Day Breakout');
  const a = C.slice(-15, -5), b = C.slice(-5); if (a.at(-1) / a[0] - 1 > 0.10 && (Math.max(...b) - Math.min(...b)) / Math.min(...b) < 0.05) setups.push('Bull Flag');
  const ma = (k) => mean(C.slice(k - 20, k)); if (C.at(-2) < ma(C.length - 1) && L.c > ma(C.length)) setups.push('Reclaim 20-DMA');
  const R = rsi(C); if (R.at(-2) < 30 && L.c > P.c) setups.push('Oversold Bounce');
  // 5-minute bars of the last session
  const mq = m.indicators.quote[0], off = m.meta.gmtoffset, dy = x => new Date((x + off) * 1000).toISOString().slice(0, 10), tm = x => new Date((x + off) * 1000).toISOString().slice(11, 16);
  const ld = dy(m.timestamp.at(-1)); const bars = [];
  m.timestamp.forEach((x, i) => { if (dy(x) === ld && mq.close[i] != null && mq.high[i] != null) bars.push({ t: tm(x), o: mq.open[i], h: mq.high[i], l: mq.low[i], c: mq.close[i], v: mq.volume[i] || 0 }); });
  const orb = bars.slice(0, 3); if (orb.length < 3) return;
  const orh = Math.max(...orb.map(x => x.h)), orl = Math.min(...orb.map(x => x.l));
  let orbHit = null; for (const x of bars.slice(3)) { if (x.c > orh) { orbHit = x.t; break; } }
  if (orbHit) setups.push('ORB Breakout');
  const tr = bars.map((x, i) => Math.max(x.h - x.l, i ? Math.abs(x.h - bars[i - 1].c) : 0, i ? Math.abs(x.l - bars[i - 1].c) : 0));
  const atr5 = mean(tr.slice(-14));
  const rvol = L.v / mean(rows.slice(-21, -1).map(r => r.v));
  return { t: decodeURIComponent(t).replace('.NS', ''), market: mk, price: L.c, prev: P.c, high: L.h, low: L.l, gap: (L.o / P.c - 1) * 100, chg: (L.c / P.c - 1) * 100, rvol, rsi: R.at(-1), setups, orh, orl, orbHit, atr5, date: ld, notional: L.c * L.v };
 } catch (e) {} }
const hits = [], all = []; let scanned = 0;
const UA = [...U, ...IN];
for (let i = 0; i < UA.length; i += 8) for (const r of await Promise.all(UA.slice(i, i + 8).map(one))) { if (r) { scanned++; all.push(r); if (r.setups.length) hits.push(r); } }
console.log(`scanned ${scanned} of ${UA.length} liquid names, ${hits.length} matched at least one rule`);
for (const s of hits) s.score = s.setups.length * 2 + s.rvol + Math.max(s.chg, 0) * 0.3 + (s.setups.includes('ORB Breakout') ? 1 : 0);
hits.sort((a, b) => b.score - a.score);
const picks = ['US', 'IN'].flatMap(m => hits.filter(h => h.market === m).slice(0, 10));
for (const s of picks) {
  // trader-exit (long): entry = break of last session's high, stop = entry - 2 x 5-min ATR (rounded down), 1R / 2R targets
  s.entry = r2(s.high + 0.01); s.stop = down(s.entry - 2 * s.atr5); s.risk = r2(s.entry - s.stop);
  s.t1 = r2(s.entry + s.risk); s.t2 = r2(s.entry + 2 * s.risk);
  s.setup = s.setups[0]; s.dir = 'LONG';
  // trader-news: Yahoo headline RSS
  try { const x = await (await fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${s.market === 'IN' ? encodeURIComponent(s.t) + '.NS' : s.t}&region=US&lang=en-US`, { headers: hdr })).text();
    s.news = [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 2).map(m => ({ title: (m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim(), pub: 'Yahoo Finance', when: (m[1].match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] })); } catch { s.news = []; }
  s.moving = Math.abs(s.chg) >= 3;
  console.log(s.t, s.setups.join('+'), 'entry', s.entry, 'stop', s.stop, 't1', s.t1, 't2', s.t2, '|', s.news[0]?.title);
}
fs.writeFileSync('picks.json', JSON.stringify({ generated: new Date().toISOString(), session: picks.find(p => p.market === 'US')?.date, sessionIN: picks.find(p => p.market === 'IN')?.date, scanned, universe: UA.length, matched: hits.length,
  config: { budget: BUDGET, maxLoss: MAXLOSS, ...CFG }, picks }, null, 1));
