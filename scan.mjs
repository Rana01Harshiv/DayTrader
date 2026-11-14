// Node port of the day-trader-skill rules (scanner daily + ORB, exit atr stop 1R/2R, budget sizing in the page, news RSS)
// plus: SHORT setups (mirror rules) and NSE index tags (Nifty 50 / Nifty 100 / Bank Nifty). Output: picks.json
import fs from 'fs';
const BUDGET = +process.env.BUDGET || 10000;
const CFG = { cash_buffer_pct: 10, max_position_pct: 75, max_order_usd: BUDGET * 0.8, min_price: 5, min_volume: 1e6 };
const PER_GROUP = 25;   // matches kept per market per side (page shows top 10 by default, "show more" for the rest)
const US = ("NVDA AAPL MSFT AMZN META GOOGL TSLA AMD AVGO NFLX PLTR COIN MSTR SMCI MU INTC UBER SHOP CRM ORCL JPM BAC XOM CVX BA DIS PYPL SOFI RIVN HOOD SNOW ARM QCOM ANET CRWD PANW LLY UNH WMT COST " +
 "ADBE CSCO IBM TXN AMAT LRCX KLAC NOW INTU ABNB DASH SQ F GM T VZ KO PEP MCD NKE SBUX HD LOW TGT CVS PFE MRK ABBV JNJ BMY GS MS C WFC V MA AXP SCHW GE CAT DE HON LMT RTX CCL RCL UAL DAL AAL LUV PLUG NIO LCID SNAP PINS ROKU RBLX U TTD DDOG NET ZS MDB OKTA WDAY TEAM LYFT AFRM UPST MARA RIOT CLSK OXY SLB COP FCX NEM").split(" ");
const hdr = { 'User-Agent': 'Mozilla/5.0' };

// ---- NSE index constituents (official CSVs, cached in indices.json as a fallback)
async function loadIndices() {
  const names = { nifty50: 'nifty50list', nifty100: 'nifty100list', banknifty: 'niftybanklist' }, out = {};
  let cache = {}; try { cache = JSON.parse(fs.readFileSync('indices.json', 'utf8')); } catch {}
  for (const [k, f] of Object.entries(names)) {
    try {
      const txt = await (await fetch(`https://nsearchives.nseindia.com/content/indices/ind_${f}.csv`, { headers: hdr })).text();
      const syms = txt.trim().split(/\r?\n/).slice(1).map(l => l.split(',')[2]).filter(Boolean);
      if (syms.length < 5) throw new Error('short list'); out[k] = syms;
    } catch { out[k] = cache[k] || []; console.log('index list fallback for', k); }
  }
  fs.writeFileSync('indices.json', JSON.stringify(out));
  return out;
}
const IDX = await loadIndices();
const INmap = {};   // symbol -> tags
for (const [k, arr] of Object.entries(IDX)) for (const s of arr) (INmap[s] ||= []).push(k);
for (const s of IDX.nifty50) if (!INmap[s].includes('nifty100')) INmap[s].push('nifty100'); // Nifty 50 sits inside Nifty 100
const INsyms = Object.keys(INmap);
console.log('India universe:', INsyms.length, '| nifty50', IDX.nifty50.length, 'nifty100', IDX.nifty100.length, 'banknifty', IDX.banknifty.length);

const get = async (t, i, r) => { for (const h of ['query2', 'query1']) { try { const j = await (await fetch(`https://${h}.finance.yahoo.com/v8/finance/chart/${t}?interval=${i}&range=${r}`, { headers: hdr })).json(); if (j.chart.result) return j.chart.result[0]; } catch {} } };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = x => Math.round(x * 100) / 100, down = x => Math.floor(x * 100 + 1e-9) / 100, up = x => Math.ceil(x * 100 - 1e-9) / 100;
function rsi(c, n = 14) { let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; } g /= n; l /= n;
  const out = [l === 0 ? 100 : 100 - 100 / (1 + g / l)];
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); } return out; }

async function one(item) { try {
  const { sym, market } = item, yt = market === 'IN' ? sym.replace('&', '%26') + '.NS' : sym;
  const d = await get(yt, '1d', '6mo'), m = await get(yt, '5m', '5d'); const q = d.indicators.quote[0];
  const rows = d.timestamp.map((_, i) => ({ o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] })).filter(r => Object.values(r).every(x => x != null));
  const C = rows.map(r => r.c), L = rows.at(-1), P = rows.at(-2);
  if (L.c < (market === 'IN' ? 20 : CFG.min_price) || L.v < (market === 'IN' ? 5e5 : CFG.min_volume)) return;
  const longS = [], shortS = [];
  const prior20 = C.slice(-21, -1);
  if (L.c > Math.max(...prior20)) longS.push('20-Day Breakout');
  if (L.c < Math.min(...prior20)) shortS.push('20-Day Breakdown');
  const a = C.slice(-15, -5), b = C.slice(-5), rng = (Math.max(...b) - Math.min(...b)) / Math.min(...b);
  if (a.at(-1) / a[0] - 1 > 0.10 && rng < 0.05) longS.push('Bull Flag');
  if (a.at(-1) / a[0] - 1 < -0.10 && rng < 0.05) shortS.push('Bear Flag');
  const ma = k => mean(C.slice(k - 20, k));
  if (C.at(-2) < ma(C.length - 1) && L.c > ma(C.length)) longS.push('Reclaim 20-DMA');
  if (C.at(-2) > ma(C.length - 1) && L.c < ma(C.length)) shortS.push('Lose 20-DMA');
  const R = rsi(C);
  if (R.at(-2) < 30 && L.c > P.c) longS.push('Oversold Bounce');
  if (R.at(-2) > 70 && L.c < P.c) shortS.push('Overbought Rejection');
  const mq = m.indicators.quote[0], off = m.meta.gmtoffset, dy = x => new Date((x + off) * 1000).toISOString().slice(0, 10), tm = x => new Date((x + off) * 1000).toISOString().slice(11, 16);
  const ld = dy(m.timestamp.at(-1)); const bars = [];
  m.timestamp.forEach((x, i) => { if (dy(x) === ld && mq.close[i] != null && mq.high[i] != null) bars.push({ t: tm(x), o: mq.open[i], h: mq.high[i], l: mq.low[i], c: mq.close[i], v: mq.volume[i] || 0 }); });
  const orb = bars.slice(0, 3); if (orb.length < 3) return;
  const orh = Math.max(...orb.map(x => x.h)), orl = Math.min(...orb.map(x => x.l));
  let upHit = null, dnHit = null;
  for (const x of bars.slice(3)) { if (!upHit && x.c > orh) upHit = x.t; if (!dnHit && x.c < orl) dnHit = x.t; }
  if (upHit) longS.push('ORB Breakout');
  if (dnHit) shortS.push('ORB Breakdown');
  const tr = bars.map((x, i) => Math.max(x.h - x.l, i ? Math.abs(x.h - bars[i - 1].c) : 0, i ? Math.abs(x.l - bars[i - 1].c) : 0));
  const atr5 = mean(tr.slice(-14)), rvol = L.v / mean(rows.slice(-21, -1).map(r => r.v));
  return { t: sym, market, indices: market === 'IN' ? INmap[sym] || [] : [], price: L.c, prev: P.c, high: L.h, low: L.l, gap: (L.o / P.c - 1) * 100, chg: (L.c / P.c - 1) * 100,
    rvol, rsi: R.at(-1), longS, shortS, upHit, dnHit, atr5, date: ld };
 } catch (e) {} }

const items = [...US.map(sym => ({ sym, market: 'US' })), ...INsyms.map(sym => ({ sym, market: 'IN' }))];
const res = []; let scanned = 0;
for (let i = 0; i < items.length; i += 8) for (const r of await Promise.all(items.slice(i, i + 8).map(one))) if (r) { scanned++; res.push(r); }

// one candidate per (stock, side)
const cands = [];
for (const r of res) {
  if (r.longS.length) cands.push({ ...r, dir: 'LONG', setups: r.longS, orbHit: r.upHit, score: r.longS.length * 2 + r.rvol + Math.max(r.chg, 0) * 0.3 + (r.upHit ? 1 : 0) });
  if (r.shortS.length) cands.push({ ...r, dir: 'SHORT', setups: r.shortS, orbHit: r.dnHit, score: r.shortS.length * 2 + r.rvol + Math.max(-r.chg, 0) * 0.3 + (r.dnHit ? 1 : 0) });
}
for (const c of cands) { delete c.longS; delete c.shortS; delete c.upHit; delete c.dnHit; }
cands.sort((a, b) => b.score - a.score);
const picks = [];
for (const m of ['US', 'IN']) for (const d of ['LONG', 'SHORT']) picks.push(...cands.filter(c => c.market === m && c.dir === d).slice(0, PER_GROUP));

for (const s of picks) {
  const k = s.dir === 'LONG' ? 1 : -1;
  if (k === 1) { s.entry = r2(s.high + 0.01); s.stop = down(s.entry - 2 * s.atr5); }       // buy above the last session high
  else { s.entry = r2(s.low - 0.01); s.stop = up(s.entry + 2 * s.atr5); }                  // sell below the last session low
  s.risk = r2(Math.abs(s.entry - s.stop)); s.t1 = r2(s.entry + k * s.risk); s.t2 = r2(s.entry + k * 2 * s.risk);
  s.setup = s.setups[0]; s.moving = Math.abs(s.chg) >= 3;
}
// headlines (one request per stock)
const seen = {};
for (const s of picks) {
  const key = s.market + s.t;
  if (seen[key]) { s.news = seen[key]; continue; }
  try { const x = await (await fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${s.market === 'IN' ? encodeURIComponent(s.t) + '.NS' : s.t}&region=US&lang=en-US`, { headers: hdr })).text();
    s.news = [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 2).map(m => ({ title: (m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim(), pub: 'Yahoo Finance', when: (m[1].match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] })); } catch { s.news = []; }
  seen[key] = s.news;
}
const cnt = (m, d) => picks.filter(p => p.market === m && p.dir === d).length;
console.log(`scanned ${scanned} of ${items.length} | candidates ${cands.length} | US L${cnt('US', 'LONG')} S${cnt('US', 'SHORT')} | IN L${cnt('IN', 'LONG')} S${cnt('IN', 'SHORT')}`);
fs.writeFileSync('picks.json', JSON.stringify({ generated: new Date().toISOString(), session: picks.find(p => p.market === 'US')?.date, sessionIN: picks.find(p => p.market === 'IN')?.date,
  scanned, universe: items.length, matched: cands.length, config: { budget: BUDGET, ...CFG }, picks }));
