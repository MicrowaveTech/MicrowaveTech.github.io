'use strict';
const STATIC_SITE = window.DASHBOARD_CONFIG?.mode === 'static';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const titles = {overview:'当日运行总览',morning:'盘前策略计划',trades:'买卖记录',close:'收盘总结',logs:'原始日志'};
const labels = {overview:'总览',morning:'盘前',trades:'买卖记录',close:'收盘总结',logs:'原始日志'};
const state = {demo:new URLSearchParams(location.search).get('demo') === '1',index:null,day:null,date:'',view:'overview',strategy:'all',query:'',side:'all',status:'all',sort:'time',ascending:false,logQuery:'',logLevel:'all',history:[],request:0,busy:false};
state.backtest='';state.backtests=[];state.catalogUpdated=null;
const num = (value, decimals = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}) : '--';
const pct = (value, signed = false) => typeof value === 'number' && Number.isFinite(value) ? `${signed && value > 0 ? '+' : ''}${num(value * 100)}%` : '--';
const signNum = value => `${typeof value === 'number' && value > 0 ? '+' : ''}${num(value)}`;
const tone = value => typeof value !== 'number' ? '' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
const sideLabel = value => ({buy:'买入',sell:'卖出',unknown:'未识别'})[value] || '未识别';
const statusLabel = value => ({filled:'已成交',submitted:'已委托',failed:'失败',pending:'待确认',unknown:'未确认'})[value] || '未确认';
const icon = name => el('i',{'data-lucide':name});
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if (value !== undefined && value !== null) node.setAttribute(key,String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function icons() { if (window.lucide) window.lucide.createIcons({attrs:{'aria-hidden':'true'}}); }
function tag(text,kind='') { return el('span',{class:`tag ${kind}`},text); }
function empty(title,detail='暂无可显示的记录',symbol='inbox') { return el('div',{class:'empty-state'},icon(symbol),el('h3',{},title),el('p',{},detail)); }
function heading(title,subtitle='',action=null) { return el('div',{class:'section-heading'},el('div',{class:'section-title'},el('h2',{},title),subtitle ? el('span',{},subtitle) : null),action); }
function goButton(text,view) { return el('button',{class:'subtle-link',onclick:()=>setView(view)},text,icon('arrow-up-right')); }
function select(options,value,change,label) { const node = el('select',{class:'filter-select','aria-label':label,onchange:event=>change(event.target.value)},options.map(([v,text])=>el('option',{value:v},text)));node.value=value;return node; }
function search(value,placeholder,change,label) { return el('label',{class:'search-wrap'},icon('search'),el('input',{class:'search-input',type:'search',value,placeholder,'aria-label':label,oninput:event=>change(event.target.value)})); }
function restoreFocus(key,position) { const node = $(`[aria-label="${key}"]`);if(node){node.focus();if(typeof node.setSelectionRange==='function')node.setSelectionRange(position,position);} }
function rerenderSearch(key,value) { const pos = $(`[aria-label="${key}"]`)?.selectionStart ?? value.length;render();restoreFocus(key,pos); }
function strategies() { const entries = new Map();for(const phase of [state.day?.morning,state.day?.close])for(const item of phase?.strategies || []){const old=entries.get(item.key)||{};entries.set(item.key,{...old,...item,candidates:phase===state.day?.morning?item.candidates:old.candidates,positions:phase===state.day?.close?item.positions:undefined});}for(const trade of state.day?.trades || [])if(!entries.has(trade.strategy))entries.set(trade.strategy,{key:trade.strategy,name:trade.strategy_name || trade.strategy});return [...entries.values()]; }
function strategyFilter() { return select([['all','全部策略'],...strategies().map(s=>[s.key,s.name])],state.strategy,value=>{state.strategy=value;render();},'筛选策略'); }
function selectedStrategies(phase) { return (phase?.strategies || []).filter(s=>state.strategy==='all'||s.key===state.strategy); }
function filteredTrades() {
  const query = state.query.toLocaleLowerCase();
  return (state.day?.trades || []).filter(t=>(state.strategy==='all'||t.strategy===state.strategy)&&(state.side==='all'||t.side===state.side)&&(state.status==='all'||t.status===state.status)&&[t.code,t.name,t.reason,t.strategy_name].some(v=>String(v||'').toLocaleLowerCase().includes(query))).sort((a,b)=>{
    const av=a[state.sort],bv=b[state.sort];if(av==null)return bv==null?0:1;if(bv==null)return -1;return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'zh-CN'))*(state.ascending?1:-1);
  });
}
async function api(path,options) {
  if(STATIC_SITE){
    const route=new URL(path,location.origin);const demo=route.pathname.includes('/demo/');
    const run=route.pathname.match(/^\/api\/backtests\/([a-f0-9]{32})\//)?.[1];const folder=demo?'demo/':run?`backtests/${run}/`:'';
    if(route.pathname.endsWith('/index')||route.pathname==='/api/refresh')path=`./data/${folder}index.json`;
    else if(route.pathname.endsWith('/day')){const date=route.searchParams.get('date');if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw new Error('日期无效');path=`./data/${folder}days/${date}.json`;}
    else throw new Error('此操作仅在本地看板可用');
    options={cache:'no-store'};path+=`?t=${Date.now()}`;
  }
  const response=await fetch(path,options);let data;try{data=await response.json();}catch{throw new Error('服务返回了无法读取的数据');}if(!response.ok)throw new Error(typeof data.error==='string'?data.error:`请求失败 (${response.status})`);return data;
}
function endpoint(part) { return `/api/${state.demo?'demo/':STATIC_SITE&&state.backtest?`backtests/${state.backtest}/`:''}${part}`; }
function setBusy(busy) { state.busy=busy;$('#loading').hidden=!busy;$('#refresh-button').disabled=busy;$('#refresh-button').classList.toggle('spinning',busy);$('#import-button').disabled=busy||state.demo;$('#date-select').disabled=busy||!state.index?.dates?.length;updateDateButtons(); }
function showError(message='') { $('#error-banner').textContent=message;$('#error-banner').hidden=!message; }
function toast(message) { $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{$('#toast').hidden=true;},4500); }
function updateDateButtons() { const dates=state.index?.dates||[];const index=dates.findIndex(d=>d.date===state.date);$('#prev-day').disabled=state.busy||index<0||index>=dates.length-1;$('#next-day').disabled=state.busy||index<=0; }
function updateChrome() {
  $('#demo-toggle').checked=state.demo;$('#demo-banner').hidden=!state.demo;$('#page-title').textContent=titles[state.view];$('#breadcrumb-view').textContent=labels[state.view];
  $('#backtest-banner').hidden=state.demo||!state.backtest;$('#run-picker').hidden=!STATIC_SITE;
  $('#run-select').replaceChildren(el('option',{value:''},'模拟交易'),...state.backtests.map(run=>el('option',{value:run.run_id},`回测 ${run.first_date||''} ～ ${run.last_date||''} · ${run.run_id.slice(0,6)}`)));
  $('#run-select').value=state.backtest;$('#run-select').disabled=state.demo;
  $$('.nav-item').forEach(node=>{node.classList.toggle('active',node.dataset.view===state.view);if(node.dataset.view===state.view)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
  $('#trade-count').textContent=String(state.day?.trades?.length||0);$('#morning-dot').classList.toggle('available',Boolean(state.day?.morning));
  const date=state.date ? new Date(`${state.date}T12:00:00`) : null;$('#day-caption').textContent=date ? `${state.date} ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()]}` : '等待日志数据';
  const updated=state.day?.updated_at||state.index?.updated_at;const time=updated ? new Date(updated) : null;$('#updated-at').textContent=time&&!Number.isNaN(time.getTime()) ? `更新于 ${time.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}` : '尚未更新';
  $('#source-count').textContent=state.demo?'虚构数据':`${state.index?.sources?.length||0} 个日志文件`;
  $('#footer-status').textContent=state.demo?'演示数据 · 非实际交易':`本地日志 · 每 ${Math.round((state.index?.refresh_seconds||3600)/60)} 分钟更新`;
  if(!state.demo&&state.index?.sync){const sync=state.index.sync;$('#footer-status').textContent=sync.last_received_at?`主动同步 · 已接收 ${sync.events} 条 · ${new Date(sync.last_received_at).toLocaleString('zh-CN',{hour12:false})}`:'本地日志 · 主动同步待接入';}
  if(STATIC_SITE){$('#import-button').hidden=true;$('.local-status>span:nth-child(2)').replaceChildren('GitHub Pages',el('small',{id:'source-count'},state.demo?'虚构数据':`已发布 ${state.index?.dates?.length||0} 个记录日`));if(!state.demo)$('#footer-status').textContent=state.index?.sync?.last_received_at?`GitHub 同步 · 最近上传 ${new Date(state.index.sync.last_received_at).toLocaleString('zh-CN',{hour12:false})}`:'GitHub 同步 · 等待首次上传';}
  if(!state.demo&&state.backtest)$('#footer-status').textContent=`回测数据 · ${state.backtest.slice(0,8)} · ${state.index?.dates?.length||0} 个记录日`;
  updateDateButtons();
}
async function loadIndex({refresh=false,provided=null}={}) {
  const token=++state.request;const mode=state.demo;setBusy(true);showError();
  try {
    let index;
    if(STATIC_SITE){const catalog=provided||await api('/api/index');if(token!==state.request||mode!==state.demo)return;state.backtests=catalog.backtests||[];state.catalogUpdated=catalog.updated_at;if(state.backtest&&!state.backtests.some(run=>run.run_id===state.backtest))state.backtest='';index=mode||state.backtest?await api(endpoint('index')):catalog;}
    else index=provided||await api(refresh&&!mode?'/api/refresh':endpoint('index'),refresh&&!mode?{method:'POST'}:undefined);
    if(token!==state.request||mode!==state.demo)return;
    const wasLatest=!state.date||state.date===state.index?.dates?.[0]?.date;
    state.index=index;
    const dates=index.dates||[];
    if(wasLatest||!dates.some(d=>d.date===state.date))state.date=dates[0]?.date||'';
    $('#date-select').replaceChildren(...(dates.length?dates.map(d=>el('option',{value:d.date},d.date)):[el('option',{value:''},'暂无日期')]));$('#date-select').value=state.date;
    if(!state.date){state.day=null;state.history=[];render();return;}
    await loadDay(token);
  } catch(error) { if(token===state.request){showError(error.message);render();} }
  finally {if(token===state.request)setBusy(false);}
}
async function loadDay(existingToken) {
  const token=existingToken??++state.request;const mode=state.demo;const date=state.date;setBusy(true);showError();
  try {
    const day=await api(`${endpoint('day')}?date=${encodeURIComponent(date)}`);
    if(token!==state.request||mode!==state.demo)return;
    if(Boolean(day.demo)!==mode)throw new Error('数据模式不匹配，已停止显示该数据');
    if(!mode&&STATIC_SITE&&(state.backtest?(day.run_mode!=='backtest'||day.run_id!==state.backtest):day.run_mode==='backtest'))throw new Error('回测与模拟交易数据不匹配，已停止显示');
    state.day=day;if(state.strategy!=='all'&&!strategies().some(s=>s.key===state.strategy))state.strategy='all';
    state.history=[];render();
    const historyDates=(state.index?.dates||[]).filter(d=>d.date<=date).slice(0,20).reverse();
    const results=await Promise.allSettled(historyDates.map(d=>d.date===date?Promise.resolve(day):api(`${endpoint('day')}?date=${encodeURIComponent(d.date)}`)));
    if(token!==state.request||mode!==state.demo)return;
    state.history=results.filter(r=>r.status==='fulfilled'&&Boolean(r.value.demo)===mode).map(r=>({date:r.value.date,value:r.value.account?.total_value})).filter(d=>typeof d.value==='number'&&Number.isFinite(d.value));
    const failed=results.filter(r=>r.status==='rejected').length;if(failed)showError(`${failed} 个历史日期未能载入，账户曲线仅显示已获取的数据。`);
    if(state.view==='overview')drawChart();
  } catch(error){if(token===state.request){state.day=null;state.history=[];render();showError(error.message);}}
  finally{if(token===state.request)setBusy(false);}
}
function setView(view) { state.view=view;render(); }
function metric(label,value,detail,symbol,kind='') { return el('div',{class:'metric'},el('div',{class:'metric-label'},label,icon(symbol)),el('div',{class:`metric-value ${kind}`},value),el('div',{class:'metric-detail'},detail)); }
function metrics() {
  const a=state.day.account||{};
  return el('section',{class:'metrics','aria-label':'账户指标'},
    metric('账户总资产',num(a.total_value),`持仓市值 ${num(a.positions_value)}`,'wallet'),
    metric('当日盈亏',signNum(a.day_pnl),el('span',{class:tone(a.day_return)},pct(a.day_return,true)),'trending-up',tone(a.day_pnl)),
    metric('累计收益',pct(a.cumulative_return,true),`累计盈亏 ${signNum(a.cumulative_pnl)}`,'chart-no-axes-combined',tone(a.cumulative_return)),
    metric('可用资金',num(a.cash),'CNY · 人民币','banknote'),
    metric('持仓仓位',pct(a.position_ratio),`${num(a.position_count,0)} 只持仓标的`,'layers-2'));
}
function phaseRow(symbol,title,detail,present,badge='已记录') { return el('div',{class:'phase'},el('div',{class:'phase-icon'},icon(symbol)),el('div',{class:'phase-content'},el('div',{class:'phase-title'},title),el('div',{class:'phase-detail'},detail)),tag(present?badge:'暂无记录',present?'':'muted')); }
function overview() {
  const d=state.day;const filled=d.trades.filter(t=>t.status==='filled');
  const chart=el('section',{class:'section'},heading('账户资产走势','最近 20 个记录日'),el('div',{class:'chart-surface'},el('div',{class:'chart-legend'},el('span',{class:'legend-line'}),'总资产',el('span',{},'单位：元')),el('div',{class:'chart-wrap'},el('canvas',{id:'asset-chart',role:'img','aria-label':'账户总资产历史走势'}),el('div',{id:'chart-empty',class:'chart-empty'},'暂无可用的资产记录'))));
  const phases=el('section',{class:'section'},heading('当日进程',d.warnings?.length?`${d.warnings.length} 条提示`:''),el('div',{class:'phase-list'},phaseRow('sunrise','盘前计划',d.morning?.time||'等待盘前日志',!!d.morning),phaseRow('arrow-left-right','交易执行',`${filled.length} 笔确认成交 / ${d.trades.length} 笔交易记录`,d.trades.length>0,'已记录'),phaseRow('sunset','收盘汇总',d.close?.time||'等待收盘日志',!!d.close)));
  const cards=strategies().filter(s=>state.strategy==='all'||s.key===state.strategy).map((s,i)=>{
    const trades=d.trades.filter(t=>t.strategy===s.key&&t.status==='filled');const holdings=s.positions?.length;const count=s.candidates?.length;
    return el('article',{class:'strategy-item'},el('div',{class:'strategy-top'},el('span',{class:'strategy-symbol'},icon(['sprout','cpu','gem','zap'][i%4])),el('div',{},el('div',{class:'strategy-name'},s.name),el('div',{class:'strategy-label'},s.key.toUpperCase()))),el('div',{class:'strategy-stats'},el('div',{},el('div',{class:'stat-label'},'策略分配'),el('div',{class:'stat-value'},pct(s.allocation))),el('div',{},el('div',{class:'stat-label'},'确认成交'),el('div',{class:'stat-value'},trades.length,el('span',{class:'stat-label'},' 笔')))),el('div',{class:'allocation-track'},el('div',{class:'allocation-fill',style:`width:${typeof s.allocation==='number'?Math.max(0,Math.min(100,s.allocation*100)):0}%`})),el('div',{class:'strategy-bottom'},el('span',{},`持仓 ${holdings??'--'} 只`),el('span',{},`盘前候选 ${count??'--'} 只`)));
  });
  return [metrics(),el('div',{class:'overview-grid'},chart,phases),el('section',{class:'strategies-section'},heading('策略运行',`${strategies().length} 个策略`,strategyFilter()),cards.length?el('div',{class:'strategy-grid'},cards):empty('暂无策略记录')),el('section',{class:'section'},heading('最新交易',`${d.trades.length} 笔记录`,goButton('全部交易','trades')),tradeTable(filteredTrades().slice(0,5),false),el('div',{class:'table-footer'},el('span',{},`已成交 ${filled.length} 笔 · 其他状态 ${d.trades.length-filled.length} 笔`),el('span',{},'金额单位：元'))),warnings(d.warnings)];
}
function warnings(items=[]) { return items.length?el('ul',{class:'warning-list'},items.map(w=>el('li',{},`${w.time||'--'} · ${w.message||''}`))):null; }
function table(headers,rows) { return el('div',{class:'table-surface'},el('table',{class:'data-table'},el('thead',{},el('tr',{},headers.map(h=>el('th',{class:h.number?'number':''},h.node||h.label||h)))),el('tbody',{},rows))); }
function security(code,name) { return el('div',{},el('div',{class:'security-name'},name||code||'--'),el('div',{class:'security-code'},code||'--')); }
function tradeTable(trades,sortable=true) {
  if(!trades.length)return empty('暂无交易记录','当前日期或筛选条件下没有交易记录','arrow-left-right');
  const specs=[['时间','time'],['标的','code'],['策略','strategy_name'],['方向','side'],['数量','quantity',true],['价格','price',true],['金额','amount',true],['状态','status']];
  const headers=specs.map(([label,key,number])=>({number,node:sortable?el('button',{class:'sort-button',onclick:()=>{state.ascending=state.sort===key?!state.ascending:true;state.sort=key;render();},'aria-label':`按${label}排序`},label,icon(state.sort===key?(state.ascending?'arrow-up':'arrow-down'):'chevrons-up-down')):label}));
  return table(headers,trades.map(t=>el('tr',{},el('td',{},t.time||'--'),el('td',{},security(t.code,t.name)),el('td',{},t.strategy_name||'未识别策略'),el('td',{},tag(sideLabel(t.side),t.side)),el('td',{class:'number'},num(t.quantity,0)),el('td',{class:'number'},num(t.price)),el('td',{class:'number'},num(t.amount)),el('td',{},tag(statusLabel(t.status),t.status==='filled'?'':t.status==='failed'?'warning':'muted'),t.reason||t.raw?el('details',{},el('summary',{class:'subtle-link',style:'margin-top:7px'},'详情'),el('pre',{class:'raw-text'},[t.reason,t.raw].filter(Boolean).join('\n'))):null))));
}
function tradesView() {
  const trades=filteredTrades();const filled=trades.filter(t=>t.status==='filled');const knownAmounts=filled.filter(t=>typeof t.amount==='number');const total=knownAmounts.length?knownAmounts.reduce((sum,t)=>sum+t.amount,0):null;
  return [el('div',{class:'filters'},search(state.query,'搜索标的、代码或原因',value=>{state.query=value;rerenderSearch('搜索交易',value);},'搜索交易'),strategyFilter(),select([['all','全部方向'],['buy','买入'],['sell','卖出'],['unknown','未识别']],state.side,value=>{state.side=value;render();},'筛选交易方向'),select([['all','全部状态'],...['filled','submitted','pending','failed','unknown'].map(s=>[s,statusLabel(s)])],state.status,value=>{state.status=value;render();},'筛选交易状态'),el('button',{class:'command-button export-button',onclick:exportTrades},icon('download'),'导出 CSV')),tradeTable(trades),el('div',{class:'table-footer'},el('span',{},`${trades.length} 笔记录 · ${filled.length} 笔确认成交`),el('span',{},`已知成交金额 ${num(total)} 元`))];
}
function lines(items) { return items?.length?el('ul',{class:'line-list'},items.map(line=>el('li',{},typeof line==='string'?line:JSON.stringify(line)))):null; }
function phaseView(type) {
  const phase=state.day[type];if(!phase)return empty(type==='morning'?'暂无盘前记录':'暂无收盘记录',`${state.date} 尚无${type==='morning'?'盘前计划':'收盘总结'}日志`,type==='morning'?'sunrise':'sunset');
  const sections=selectedStrategies(phase).map(s=>{
    let content;
    if(type==='morning')content=s.candidates?.length?table(['标的','计划','筛选详情'],s.candidates.map(c=>el('tr',{},el('td',{},security(c.code,c.name)),el('td',{},c.role||'--'),el('td',{class:'detail-cell'},c.detail||'--')))):empty('暂无候选标的','该策略没有已识别的候选记录');
    else content=s.positions?.length?table(['标的',{label:'数量',number:true},{label:'成本',number:true},{label:'现价',number:true},{label:'市值',number:true},{label:'浮动盈亏',number:true},{label:'收益率',number:true},{label:'仓位',number:true}],s.positions.map(p=>el('tr',{},el('td',{},security(p.code,p.name)),el('td',{class:'number'},num(p.quantity,0)),el('td',{class:'number'},num(p.cost)),el('td',{class:'number'},num(p.price)),el('td',{class:'number'},num(p.value)),el('td',{class:`number ${tone(p.pnl)}`},signNum(p.pnl)),el('td',{class:`number ${tone(p.return)}`},pct(p.return,true)),el('td',{class:'number'},pct(p.weight))))):empty('暂无持仓明细','该策略没有已识别的持仓记录');
    const detail=el('details',{},el('summary',{class:'subtle-link'},'策略完整日志'),lines(s.lines));
    const schedule=(s.lines||[]).filter(line=>/调仓|周期/.test(line)&&line.length<200);
    return el('section',{class:'phase-strategy'},heading(s.name,'',el('span',{class:'allocation-badge'},`策略分配 ${pct(s.allocation)}`)),lines(schedule),content,detail);
  });
  const attributed=new Set((phase.strategies||[]).flatMap(s=>s.lines||[]));
  const common=(phase.lines||[]).filter(line=>!attributed.has(line));
  return [type==='close'?metrics():null,el('div',{class:'phase-summary'},icon(type==='morning'?'sunrise':'sunset'),el('strong',{},type==='morning'?'盘前策略快照':'收盘账户快照'),el('span',{},phase.time||'时间未记录'),tag('已记录')),el('div',{class:'filters'},strategyFilter()),common.length?el('details',{},el('summary',{class:'subtle-link'},'账户汇总日志'),lines(common)):null,sections.length?sections:empty('暂无策略明细')];
}
function logsView() {
  const query=state.logQuery.toLocaleLowerCase();const logs=(state.day.logs||[]).filter(l=>(state.strategy==='all'||l.strategy===state.strategy)&&(state.logLevel==='all'||String(l.level).toUpperCase()===state.logLevel)&&[l.message,l.time,l.strategy,l.phase].some(v=>String(v||'').toLocaleLowerCase().includes(query)));
  return [el('div',{class:'filters'},search(state.logQuery,'搜索日志内容',value=>{state.logQuery=value;rerenderSearch('搜索日志',value);},'搜索日志'),strategyFilter(),select([['all','全部级别'],['INFO','INFO'],['WARNING','WARNING'],['ERROR','ERROR'],['DEBUG','DEBUG']],state.logLevel,value=>{state.logLevel=value;render();},'筛选日志级别'),el('span',{class:'stat-label'},`${logs.length} 条记录`)),logs.length?el('div',{class:'log-list'},logs.map(l=>el('div',{class:'log-row'},el('span',{class:'log-time'},l.time||'--'),el('span',{class:`log-level ${String(l.level).toLowerCase()}`},l.level||'INFO'),el('div',{},el('p',{class:'log-message'},l.message||''),el('details',{},el('summary',{},'记录详情'),el('pre',{class:'raw-text'},JSON.stringify(l,null,2))))))):empty('暂无日志记录','当前筛选条件下没有原始日志','logs')];
}
function render() {
  updateChrome();const root=$('#workspace');
  if(!state.day){root.replaceChildren(empty('暂无日志数据',state.demo?'演示数据暂不可用':'导入日志后，此处将显示当日记录'));icons();return;}
  const nodes=state.view==='overview'?overview():state.view==='trades'?tradesView():state.view==='logs'?logsView():phaseView(state.view);
  root.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));icons();if(state.view==='overview')requestAnimationFrame(drawChart);
}
function drawChart() {
  const canvas=$('#asset-chart');if(!canvas)return;const rect=canvas.getBoundingClientRect();if(!rect.width)return;
  const ratio=devicePixelRatio||1;canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);const w=rect.width,h=rect.height;
  const data=state.history.length?state.history:(typeof state.day?.account?.total_value==='number'?[{date:state.date,value:state.day.account.total_value}]:[]);$('#chart-empty').hidden=data.length>0;
  const left=60,right=15,top=18,bottom=29;const plotW=Math.max(1,w-left-right),plotH=Math.max(1,h-top-bottom);
  if(!data.length)return;const vals=data.map(d=>d.value);const minVal=Math.min(...vals),maxVal=Math.max(...vals);const range=maxVal-minVal||Math.max(Math.abs(maxVal)*.02,1);const lo=minVal-range*.2,hi=maxVal+range*.2;
  ctx.font='9px -apple-system, sans-serif';ctx.textBaseline='middle';
  for(let i=0;i<4;i++){const y=top+plotH*i/3;const value=hi-(hi-lo)*i/3;ctx.strokeStyle='#eaf0ec';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='#a1ada4';ctx.textAlign='right';ctx.fillText(value.toLocaleString('zh-CN',{maximumFractionDigits:0}),left-9,y);}
  const points=data.map((d,i)=>({x:data.length===1?left+plotW/2:left+plotW*i/(data.length-1),y:top+(hi-d.value)/(hi-lo)*plotH}));
  ctx.setLineDash([]);if(points.length>1){ctx.beginPath();ctx.moveTo(points[0].x,top+plotH);points.forEach(p=>ctx.lineTo(p.x,p.y));ctx.lineTo(points.at(-1).x,top+plotH);ctx.closePath();ctx.fillStyle='#147d700a';ctx.fill();ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#258c77';ctx.lineWidth=2;ctx.lineJoin='round';ctx.stroke();}
  points.forEach((p,i)=>{if(points.length<9||i===points.length-1){ctx.beginPath();ctx.arc(p.x,p.y,2.7,0,Math.PI*2);ctx.fillStyle='#258c77';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}});
  const labelIndices=[...new Set([0,Math.floor((data.length-1)/2),data.length-1])];ctx.fillStyle='#a1ada4';ctx.textAlign='center';for(const i of labelIndices)ctx.fillText(data[i].date.slice(5),points[i].x,h-10);
  canvas.setAttribute('aria-label',`账户总资产走势，${data.map(d=>`${d.date} ${num(d.value)} 元`).join('，')}`);
}
function csvCell(value) { let text=value==null?'':String(value);if(/^[\s]*[=+@-]/.test(text)&&typeof value!=='number')text=`'${text}`;return `"${text.replaceAll('"','""')}"`; }
function exportTrades() {
  const trades=filteredTrades();const rows=[['日期','时间','策略','代码','名称','方向','数量','价格','金额','状态','原因'],...trades.map(t=>[state.date,t.time,t.strategy_name,t.code,t.name,sideLabel(t.side),t.quantity,t.price,t.amount,statusLabel(t.status),t.reason])];
  const blob=new Blob(['\uFEFF',rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const link=el('a',{href:url,download:`${state.demo?'演示-':''}交易记录-${state.date}.csv`});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出 ${trades.length} 笔记录`);
}
async function importFile(event) {
  const file=event.target.files[0];event.target.value='';if(!file)return;if(state.demo){toast('请先关闭演示模式');return;}if(file.size>10*1024*1024){showError('日志文件不能超过 10 MiB');return;}
  const token=++state.request;setBusy(true);showError();
  try{const text=await file.text();const index=await api('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,text})});if(token!==state.request)return;state.date='';await loadIndex({provided:index});toast(`已导入 ${file.name}`);}catch(error){if(token===state.request)showError(error.message);}finally{if(token===state.request)setBusy(false);}
}
$$('.nav-item').forEach(node=>node.addEventListener('click',()=>setView(node.dataset.view)));
$('#refresh-button').addEventListener('click',()=>loadIndex({refresh:true}));
$('#run-select').addEventListener('change',event=>{state.backtest=event.target.value;state.index=null;state.day=null;state.date='';state.history=[];state.strategy='all';render();loadIndex();});
$('#import-button').addEventListener('click',()=>$('#file-input').click());$('#file-input').addEventListener('change',importFile);
$('#date-select').addEventListener('change',event=>{state.date=event.target.value;loadDay();});
$('#prev-day').addEventListener('click',()=>{const dates=state.index.dates;const index=dates.findIndex(d=>d.date===state.date);if(dates[index+1]){state.date=dates[index+1].date;$('#date-select').value=state.date;loadDay();}});
$('#next-day').addEventListener('click',()=>{const dates=state.index.dates;const index=dates.findIndex(d=>d.date===state.date);if(dates[index-1]){state.date=dates[index-1].date;$('#date-select').value=state.date;loadDay();}});
$('#demo-toggle').addEventListener('change',event=>{state.demo=event.target.checked;state.index=null;state.day=null;state.date='';state.history=[];state.strategy='all';const url=new URL(location.href);if(state.demo)url.searchParams.set('demo','1');else url.searchParams.delete('demo');history.replaceState(null,'',url);render();loadIndex();});
window.addEventListener('resize',()=>{clearTimeout(drawChart.timer);drawChart.timer=setTimeout(drawChart,100);});
setInterval(()=>{if(!state.busy)loadIndex({refresh:true});},3600000);
setInterval(async()=>{if(state.busy||state.demo)return;const token=state.request;try{const index=await api('/api/index');if(token===state.request&&!state.demo&&!state.busy&&(STATIC_SITE?index.updated_at!==state.catalogUpdated:index.updated_at!==state.index?.updated_at||index.sync?.events!==state.index?.sync?.events))loadIndex({provided:index});}catch{/* The explicit hourly refresh reports connection failures. */}},60000);
render();loadIndex();
