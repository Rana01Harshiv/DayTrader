import fs from 'fs';
const D=JSON.parse(fs.readFileSync('raw.json'));
const r2=x=>Math.round(x*100)/100;
for(const s of D){
  const up=s.chg>=0, dir=up?'LONG':'SHORT';
  const orbBreak = up ? s.price>s.orh : s.price<s.orl;
  const brk20 = up && s.price>=s.hi20*0.995;
  let setup;
  if(Math.abs(s.gap)>=1.5 && Math.abs(s.chg)>=Math.abs(s.gap)) setup=up?'Gap & Go':'Gap Down Continuation';
  else if(brk20) setup='Momentum Breakout';
  else if(orbBreak) setup=up?'ORB Breakout':'ORB Breakdown';
  else setup=up?'High-RVOL Momentum':'High-RVOL Breakdown';
  s.dir=dir;s.setup=setup;
  s.score=s.rvol*2+Math.abs(s.chg)+Math.abs(s.gap)*0.7+(orbBreak?1:0)+(brk20?1:0);
  s.range_pct=(s.high-s.low)/s.price*100;
}
const picks=D.filter(s=>s.rvol>=0.9&&Math.abs(s.chg)>=1.5).sort((a,b)=>b.score-a.score).slice(0,5);
for(const s of picks){
  const long=s.dir==='LONG', k=long?1:-1, buf=Math.max(0.02,s.price*0.0003);
  s.entry=r2(long? s.high+buf : s.low-buf);        // trigger: break of last session extreme
  const risk=Math.max(0.35*s.atr,0.01);
  s.stop=r2(s.entry-k*risk); s.risk=r2(Math.abs(s.entry-s.stop));
  s.t1=r2(s.entry+k*1.5*s.risk); s.t2=r2(s.entry+k*3*s.risk);
  try{const j=await (await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${s.t}&newsCount=3&quotesCount=0`,{headers:{'User-Agent':'Mozilla/5.0'}})).json();
    s.news=(j.news||[]).slice(0,2).map(n=>({title:n.title,pub:n.publisher}));}catch{s.news=[]}
  console.log(s.t,s.dir,s.setup,s.entry,s.stop,s.t1,s.t2,s.news[0]?.title);
}
fs.writeFileSync('picks.json',JSON.stringify({generated:new Date().toISOString(),session:picks[0].date,picks},null,1));
