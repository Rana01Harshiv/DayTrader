import fs from 'fs';
const T="NVDA AAPL MSFT AMZN META GOOGL TSLA AMD AVGO NFLX PLTR COIN MSTR SMCI MU INTC UBER SHOP CRM ORCL JPM BAC XOM CVX BA DIS PYPL SOFI RIVN HOOD SNOW ARM QCOM ANET CRWD PANW LLY UNH WMT COST".split(" ");
const get=async(t,i,r)=>(await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=${i}&range=${r}`,{headers:{'User-Agent':'Mozilla/5.0'}})).json()).chart.result[0];
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
async function one(t){try{
 const d=await get(t,'1d','3mo'),m=await get(t,'5m','5d');const q=d.indicators.quote[0];
 const rows=d.timestamp.map((_,i)=>[q.open[i],q.high[i],q.low[i],q.close[i],q.volume[i]]).filter(r=>r.every(x=>x!=null));
 const L=rows.at(-1),P=rows.at(-2);
 const rvol=L[4]/mean(rows.slice(-21,-1).map(r=>r[4]));
 const atr=mean(rows.slice(-14).map((r,i)=>{const p=rows.slice(-15)[i];return Math.max(r[1]-r[2],Math.abs(r[1]-p[3]),Math.abs(r[2]-p[3]))}));
 const hi20=Math.max(...rows.slice(-21,-1).map(r=>r[1]));
 const mq=m.indicators.quote[0],off=m.meta.gmtoffset;const dy=x=>new Date((x+off)*1000).toISOString().slice(0,10);
 const ld=dy(m.timestamp.at(-1));const bars=[];
 m.timestamp.forEach((x,i)=>{if(dy(x)===ld&&mq.close[i]!=null)bars.push([mq.open[i],mq.high[i],mq.low[i],mq.close[i],mq.volume[i]||0])});
 const orb=bars.slice(0,6);const vv=bars.reduce((s,b)=>s+b[4],0)||1;
 return {t,price:L[3],prev:P[3],open:L[0],high:L[1],low:L[2],gap:(L[0]/P[3]-1)*100,chg:(L[3]/P[3]-1)*100,rvol,atr,hi20,
  orh:Math.max(...orb.map(b=>b[1])),orl:Math.min(...orb.map(b=>b[2])),vwap:bars.reduce((s,b)=>s+(b[1]+b[2]+b[3])/3*b[4],0)/vv,date:ld,vol:L[4]};
}catch(e){console.log('fail',t,e.message)}}
const R=[];for(let i=0;i<T.length;i+=8)R.push(...(await Promise.all(T.slice(i,i+8).map(one))));
const D=R.filter(Boolean);fs.writeFileSync('raw.json',JSON.stringify(D));
console.log(D.length);D.sort((a,b)=>b.rvol*Math.abs(b.chg)-a.rvol*Math.abs(a.chg)).slice(0,14).forEach(r=>console.log(r.t,r.price.toFixed(2),'gap',r.gap.toFixed(2),'chg',r.chg.toFixed(2),'rvol',r.rvol.toFixed(2),r.date));
