/**
 * dsh-whale-balance —— 让瘦鲸自己知道还剩多少白饭（DeepSeek 账户余额）
 *
 * 数据来源：~/.dsh/.credentials.yaml 里的 refs.<name>（DSH 自己那把 key），
 *          调官方 /user/balance。不新增凭据、不外传、不落日志。
 *
 * 三项可在设置页里改（存 /sdcard/DeepseekHarness/whale-balance/config.json，热生效）：
 *   injectContext  每轮是否往上下文塞一行余额
 *   injectText     塞什么（{balance} {currency} {low} 会被替换）
 *   toolEnabled    要不要给工具入口 whale_balance
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

let defineTool = null
try {
  const base = process.env.DSH_HOST_MODULES
    || '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
  defineTool = (await import(base + '/dsh-tools/lib/index.js')).defineTool
} catch (e) {
  console.warn('[whale-balance] defineTool 取不到:', e.message)
}


/** 首页角标：纯原生 DOM，60 秒拉一次 /dsh-wb/status。 */
function buildBadgeJs(data, cfg) {
  const payload = JSON.stringify(data || {}).replace(/</g, '\\u003c')
  const cfgJson = JSON.stringify(cfg || {}).replace(/</g, '\\u003c')
  return `(function(){
  if (window.__WB_BADGE__) return;
  window.__WB_BADGE__ = 1;
  var D = ${payload};
  var C = ${cfgJson};

  var el = document.getElementById('__wb_badge');
  if (!el) {
  el = document.createElement('div');
  el.id = '__wb_badge';
  el.title = '白饭余额';
  el.style.cssText = 'position:fixed;z-index:99998;padding:3px 9px;' +
    'border-radius:8px;background:rgba(20,22,28,.85);color:#9fd0ff;font:12px/1.7 -apple-system,sans-serif;' +
    'border:1px solid rgba(120,170,255,.35);cursor:grab;user-select:none;' +
    'touch-action:none;backdrop-filter:blur(4px)';
  }

  // 位置：优先用上次拖到的地方
  (function place(){
    var pos = null;
    try { pos = JSON.parse(localStorage.getItem('__wb_badge_pos') || 'null') } catch(e) {}
    if (pos && isFinite(pos.x) && isFinite(pos.y)) {
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
    } else {
      el.style.left = '10px';
      el.style.bottom = '10px';
    }
  })();

  // 拖动：pointer 事件，手机与桌面都吃
  (function drag(){
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    function clamp(x, y){
      var w = el.offsetWidth || 80, h = el.offsetHeight || 24;
      var maxX = Math.max(0, window.innerWidth - w - 2);
      var maxY = Math.max(0, window.innerHeight - h - 2);
      return [Math.min(Math.max(0, x), maxX), Math.min(Math.max(0, y), maxY)];
    }
    el.addEventListener('pointerdown', function(e){
      dragging = true;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      var r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      el.style.bottom = 'auto';
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.cursor = 'grabbing';
      e.preventDefault();
    });
    el.addEventListener('pointermove', function(e){
      if (!dragging) return;
      var p = clamp(ox + (e.clientX - sx), oy + (e.clientY - sy));
      el.style.left = p[0] + 'px';
      el.style.top = p[1] + 'px';
      e.preventDefault();
    });
    function end(e){
      if (!dragging) return;
      dragging = false;
      el.style.cursor = 'grab';
      try {
        var r = el.getBoundingClientRect();
        localStorage.setItem('__wb_badge_pos', JSON.stringify({ x: r.left, y: r.top }));
      } catch(err) {}
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  })();

  function render(d){
    var b = d || {};
    var v = Number(b.balance);
    if (!isFinite(v)) { el.textContent = '白饭 ?'; el.style.color = '#ff8f6b'; return }
    el.textContent = '白饭 ' + (b.currency || 'CNY') + ' ' + v.toFixed(2);
    el.style.color = b.low ? '#ff8f6b' : '#9fd0ff';
  }

  window.__WB_RENDER = function(d){ render((d && d.balance) || d) };

  // ---- 点击打开设置面板（拖动时不触发）----
  var moved = 0, panel = null;
  el.addEventListener('pointerdown', function(){ moved = 0 });
  el.addEventListener('pointermove', function(){ moved++ });
  el.addEventListener('click', function(){ if (moved < 3) togglePanel() });

  function mk(tag, css, text){
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function togglePanel(){
    if (panel) { panel.remove(); panel = null; return }
    var P = mk('div', 'position:fixed;z-index:99999;width:270px;padding:12px 14px;' +
      'border-radius:12px;background:rgba(26,28,36,.97);color:#ddd;font:13px/1.7 -apple-system,sans-serif;' +
      'border:1px solid rgba(120,170,255,.3);box-shadow:0 8px 28px rgba(0,0,0,.45)');
    var head = mk('div','display:flex;justify-content:space-between;align-items:center;margin-bottom:6px');
    head.appendChild(mk('div','font-weight:600','白饭余额 · 设置'));
    var close = mk('div','cursor:pointer;padding:0 4px;opacity:.7;font-size:15px;line-height:1','✕');
    close.addEventListener('click', function(e){ e.stopPropagation(); if (panel) { panel.remove(); panel = null } });
    head.appendChild(close);
    P.appendChild(head);

    function row(label, input){
      var d = mk('label','display:flex;gap:7px;align-items:center;margin:6px 0');
      d.appendChild(input); d.appendChild(mk('span','',label)); return d;
    }
    var cbBadge = mk('input'); cbBadge.type='checkbox'; cbBadge.checked = C.showBadge !== false;
    var cbCtx = mk('input'); cbCtx.type='checkbox'; cbCtx.checked = !!C.injectContext;
    var low = mk('input'); low.type='number'; low.step='0.5'; low.min='0'; low.value = String(C.lowWater == null ? 5 : C.lowWater);
    low.style.cssText='width:62px;background:#181a20;color:#ddd;border:1px solid #333;border-radius:6px;padding:2px 6px';
    var ta = mk('textarea'); ta.value = C.injectText || ''; ta.placeholder='【白饭】余额 {currency} {balance}，{low}';
    ta.style.cssText='width:100%;min-height:46px;box-sizing:border-box;margin-top:6px;background:#181a20;color:#ddd;' +
      'border:1px solid #333;border-radius:8px;padding:6px 8px;font:inherit';
    var numCss = 'width:56px;background:#181a20;color:#ddd;border:1px solid #333;border-radius:6px;padding:2px 6px';
    function pair(min, max, step, val, label){
      var wrap = mk('div','display:flex;gap:8px;align-items:center;margin:6px 0');
      wrap.appendChild(mk('span','width:64px;opacity:.8', label));
      var r = mk('input'); r.type='range'; r.min=String(min); r.max=String(max); r.step=String(step); r.value=String(val);
      r.style.cssText='flex:1;accent-color:#6ea8fe';
      var n = mk('input'); n.type='number'; n.min=String(min); n.max=String(max); n.step=String(step); n.value=String(val);
      n.style.cssText=numCss;
      r.addEventListener('input', function(){ n.value = r.value });
      n.addEventListener('input', function(){ r.value = n.value });
      wrap.appendChild(r); wrap.appendChild(n);
      return { wrap: wrap, range: r, num: n };
    }
    var fsPair = pair(10, 28, 1, C.fontSize || 12, '字号');
    var opPair = pair(0.2, 1, 0.05, (C.opacity == null ? 0.85 : C.opacity), '透明度');
    var cN = mk('input'); cN.value=C.colorNormal||'#4cd07d'; cN.style.cssText='width:78px;background:#181a20;color:#ddd;border:1px solid #333;border-radius:6px;padding:2px 6px';
    var cL = mk('input'); cL.value=C.colorLow||'#ff5b5b'; cL.style.cssText=cN.style.cssText;
    var cbPeak = mk('input'); cbPeak.type='checkbox'; cbPeak.checked = C.showPeak !== false;

    var btn = mk('button','margin-top:8px;padding:5px 14px;border-radius:8px;border:1px solid #333;' +
      'background:#23262e;color:#ddd;cursor:pointer','保存');
    var msg = mk('div','font-size:12px;color:#3fa36a;margin-top:6px;min-height:16px');

    P.appendChild(row('显示角标', cbBadge));
    P.appendChild(row('每轮写进上下文', cbCtx));
    P.appendChild(row('低水位（元）', low));
    P.appendChild(ta);
    P.appendChild(row('显示峰时/谷时', cbPeak));
    P.appendChild(fsPair.wrap);
    P.appendChild(opPair.wrap);
    P.appendChild(row('边框·正常色', cN));
    P.appendChild(row('边框·超水位色', cL));
    P.appendChild(btn);
    P.appendChild(msg);
    P.appendChild(mk('div','font-size:11px;opacity:.5;margin-top:4px','改完刷新页面生效'));

    btn.addEventListener('click', function(){
      var q = '/dsh-wb/set?showBadge=' + (cbBadge.checked ? 1 : 0) +
        '&injectContext=' + (cbCtx.checked ? 1 : 0) +
        '&lowWater=' + encodeURIComponent(low.value) +
        '&injectText=' + encodeURIComponent(ta.value) +
        '&showPeak=' + (cbPeak.checked ? 1 : 0) +
        '&fontSize=' + encodeURIComponent(fsPair.num.value) +
        '&opacity=' + encodeURIComponent(opPair.num.value) +
        '&colorNormal=' + encodeURIComponent(cN.value) +
        '&colorLow=' + encodeURIComponent(cL.value);
      var sc = document.createElement('script');
      sc.src = q + '&t=' + Date.now();
      sc.onload = function(){ msg.textContent = '已保存' };
      sc.onerror = function(){ msg.textContent = '保存请求失败' };
      document.body.appendChild(sc);
      setTimeout(function(){ if (!msg.textContent) msg.textContent = '已发送' }, 800);
    });

    // 打开时先拉一次真实配置，回填到控件
    window.__WB_PANEL_SYNC = function(c){
      if (!c) return;
      try {
        cbBadge.checked = c.showBadge !== false;
        cbCtx.checked = !!c.injectContext;
        low.value = String(c.lowWater == null ? 5 : c.lowWater);
        ta.value = c.injectText || '';
        cbPeak.checked = c.showPeak !== false;
        fsPair.range.value = String(c.fontSize || 12); fsPair.num.value = String(c.fontSize || 12);
        opPair.range.value = String(c.opacity == null ? 0.85 : c.opacity); opPair.num.value = String(c.opacity == null ? 0.85 : c.opacity);
        cN.value = c.colorNormal || '#4cd07d';
        cL.value = c.colorLow || '#ff5b5b';
      } catch(e) {}
    };
    (function pullCfg(){
      var sc = document.createElement('script');
      sc.src = '/dsh-wb/cfg.js?t=' + Date.now();
      sc.onerror = function(){};
      document.body.appendChild(sc);
    })();

    document.body.appendChild(P);
    panel = P;
    // 贴着角标：默认在它正上方，放不下就放下面
    (function place(){
      var r = el.getBoundingClientRect();
      var pw = P.offsetWidth || 280, ph = P.offsetHeight || 200;
      var left = Math.min(Math.max(4, r.left), Math.max(4, window.innerWidth - pw - 4));
      var top = r.top - ph - 6;
      if (top < 4) top = Math.min(window.innerHeight - ph - 4, r.bottom + 6);
      P.style.left = left + 'px';
      P.style.top = Math.max(4, top) + 'px';
      P.style.bottom = 'auto';
    })();
  }
  render(D.balance || D);

  function pull(){
    try {
      var old = document.getElementById('__wb_data');
      if (old) old.remove();
      var sc = document.createElement('script');
      sc.id = '__wb_data';
      sc.src = '/dsh-wb/badge-data.js?t=' + Date.now();
      sc.onerror = function(){};
      (document.body || document.head || document.documentElement).appendChild(sc);
    } catch(e) {}
  }
  setTimeout(pull, 1500);
  setInterval(pull, 20000);
  setTimeout(function(){ try { document.body.appendChild(el) } catch(e){} }, 1200);
})()` }

export const name = 'dsh-whale-balance'

const DEFAULT_CRED = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
const CONFIG_FILE = '/sdcard/DeepseekHarness/whale-balance/config.json'

const DEFAULTS = {
  // 角标要往首页注入脚本；宿主启动对这一步很敏感，默认关闭，谁要谁开
  showBadge: false,
  fontSize: 12,
  opacity: 0.85,
  colorNormal: '#9fd0ff',
  colorLow: '#ff8f6b',
  showPeak: true,
  injectContext: false,
  injectText: '【白饭】余额 {currency} {balance}，{low} · {peak}',
  toolEnabled: true,
  refName: 'DEEPSEEK_API_KEY',
  lowWater: 5,
}

function readConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

function writeConfig(patch) {
  const next = { ...readConfig() }
  for (const k of Object.keys(DEFAULTS)) {
    if (patch[k] === undefined) continue
    if (typeof DEFAULTS[k] === 'boolean') next[k] = Boolean(patch[k])
    else if (typeof DEFAULTS[k] === 'number') {
      const n = Number(patch[k])
      if (Number.isFinite(n)) next[k] = n
    } else next[k] = String(patch[k])
  }
  try {
    mkdirSync(dirname(CONFIG_FILE), { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch (e) {
    console.warn('[whale-balance] 写配置失败:', e.message)
  }
  return next
}

/** 从 creds yaml 里取 refs.<name>。结构简单，逐行扫。 */
function readRef(file, refName) {
  const text = readFileSync(file, 'utf8')
  let inRefs = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    if (/^\S/.test(line)) {
      inRefs = /^refs\s*:/.test(line)
      continue
    }
    if (!inRefs) continue
    const re = new RegExp('^\\s+' + refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(\\S+)\\s*$')
    const m = re.exec(line)
    if (m) return m[1].replace(/^['"]|['"]$/g, '')
  }
  return ''
}

const yuan = n => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : String(n))

async function queryBalance(cfg) {
  const key = readRef(DEFAULT_CRED, cfg.refName || DEFAULTS.refName)
  if (!key) return { ok: false, text: '凭据文件里没有 ' + (cfg.refName || 'DEEPSEEK_API_KEY') }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 6000)
  let res
  try {
    res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: 'Bearer ' + key },
      signal: ac.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) return { ok: false, text: '接口回了 ' + res.status }
  const info = (data.balance_infos || [])[0] || {}
  const balance = Number(info.total_balance ?? NaN)
  const low = Number.isFinite(balance) && balance < Number(cfg.lowWater ?? DEFAULTS.lowWater)
  return {
    ok: true,
    available: data.is_available !== false,
    currency: info.currency || 'CNY',
    balance: Number.isFinite(balance) ? balance : 0,
    toppedUp: Number(info.topped_up_balance ?? 0),
    low,
    text: '余额 ' + (info.currency || 'CNY') + ' ' + yuan(balance) + (data.is_available === false ? ' · 账户不可用' : ''),
  }
}

function renderInject(cfg, r) {
  if (!r?.ok) return ''
  const low = r.low ? '低于警戒线 ' + yuan(cfg.lowWater) + '，省着点用' : '还够'
  // 官方口径：北京时间 9:00-12:00、14:00-18:00 为高峰，其余空闲半价
  const d = new Date()
  // 容器时区可能不是北京；按 UTC+8 算“北京时间”
  const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + 8 * 60) % (24 * 60)
  const peak = (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60)
  const peakText = peak ? '峰时，贵一倍' : '谷时，半价'
  return String(cfg.injectText || DEFAULTS.injectText)
    .replace(/\{balance\}/g, yuan(r.balance))
    .replace(/\{currency\}/g, r.currency)
    .replace(/\{low\}/g, low)
    .replace(/\{peak\}/g, peakText)
    .replace(/\{peakWord\}/g, peak ? '峰时' : '谷时')
}

export function apply(root, config = {}) {
  try {
    appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
      new Date().toISOString() + ' apply start\n')
  } catch {}
  // ---- 首页注入行：宿主在启动时一次性收集，订阅必须最早 ----
  try {
    root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        if (!readConfig().showBadge) return
        for (const row of table) {
          if (row && row.kind === 'script' && typeof row.text === 'string'
            && row.text.indexOf('__WB_BADGE__') >= 0) return
        }
        table.push({ kind: 'script', placement: 'body', text: buildBadgeJs(cache.r, readConfig()) })
        try {
          appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
            new Date().toISOString() + ' badge-row pushed\n')
        } catch {}
      } catch (e) { /* 注入失败也不能拖垮宿主 */ }
    })
  } catch (e) {
    console.warn('[whale-balance] index-inject 订阅失败:', e.message)
  }

  let live = { ...readConfig(), ...(config && typeof config === 'object' ? {} : {}) }
  let cache = { at: 0, r: null }

  const fresh = async (force = false) => {
    const now = Date.now()
    if (!force && cache.r && now - cache.at < 30_000) return cache.r
    let r
    try {
      r = await queryBalance(live)
    } catch (e) {
      r = { ok: false, text: '请求失败：' + e.message }
    }
    // 成功才覆盖缓存；失败保留上一次的好值，不把"失败"写进页面
    if (r && r.ok) cache = { at: now, r }
    else if (!cache.r) cache = { at: now, r }
    return r
  }

  // ---- 工具入口 ----
  if (defineTool) root.inject(['tools'], (ctx) => {
    try {
      const tool = defineTool({
        name: 'whale_balance',
        description: '查 DeepSeek 账户还剩多少钱（白饭）。返回余额、是否可用、是否低于警戒线。',
        parameters: {},
        output: {
          schema: { type: 'object', properties: {}, additionalProperties: true },
          render: (_a, v) => [{
            type: 'text',
            text: (v && v.text) ? String(v.text) : '查余额失败',
          }],
        },
        execute: async () => {
          live = readConfig()
          if (!live.toolEnabled) return { ok: false, text: '工具入口在设置里关着。' }
          return fresh(true)
        },
      })
      ctx.tools.register(tool)
      console.log('[whale-balance] tool ready')
    } catch (e) {
      console.warn('[whale-balance] 工具注册失败:', e.message)
    }
  })

  // ---- 每轮注入 ----
  root.inject(['systemPrompt'], (ctx) => {
  try {
      ctx.systemPrompt.context({
        name: 'whale-balance:line',
        order: 960,
        text: () => {
          live = readConfig()
          if (!live.injectContext) return ''
          // 同步返回：用最近一次缓存，不阻塞这一轮；没有缓存就先空着
          if (!cache.r || Date.now() - cache.at > 5 * 60_000) {
            void fresh(true)
  try {
    const iv = setInterval(() => {
      if (!cache.r || cache.r.ok === false) void fresh(true)
    }, 10000)
    if (typeof iv.unref === 'function') iv.unref()
  } catch {}
            return ''
          }
          return renderInject(live, cache.r)
        },
      })
  } catch (e) {
    console.warn('[whale-balance] 注入失败:', e.message)
  }
  })
  void fresh(true)

  // ---- 设置页 API ----
  root.inject(['webServer'], (ctx) => {
    const server = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
    if (!server || typeof server.register !== 'function') return
    // 换一种挂法：监听挂在 webServer 服务的 ctx 上
    try {
      ctx.on('webserver/index-inject', (table) => {
        try {
          appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
            new Date().toISOString() + ' badge-row(inner)\n')
          if (!Array.isArray(table)) return
          if (!readConfig().showBadge) return
          for (const row of table) {
            if (row && row.kind === 'script' && typeof row.text === 'string'
              && row.text.indexOf('__WB_BADGE__') >= 0) return
          }
          table.push({ kind: 'script', placement: 'body', text: buildBadgeJs(cache.r, readConfig()) })
        } catch {}
      })
    } catch (e) {
      console.warn('[whale-balance] inner 订阅失败:', e.message)
    }

    if (typeof server.tapIndex === 'function') {
      // tapIndex 是纯函数 html→html，必须返回字符串
      try {
        ctx.effect(() => server.tapIndex((html) => {
          try {
            if (typeof html !== 'string') return html
            if (!readConfig().showBadge) return html
            if (html.indexOf('__WB_BADGE__') !== -1) return html
            const b = (cache.r && cache.r.ok) ? cache.r : null
            const cfgNow = readConfig()
            const num = b ? (b.currency || 'CNY') + ' ' + Number(b.balance).toFixed(2) : '…'
            const borderCol = (b && b.low) ? (cfgNow.colorLow || '#ff5b5b') : (cfgNow.colorNormal || '#4cd07d')
            const fs = Number(cfgNow.fontSize) || 12
            const opv = Number(cfgNow.opacity); const opacity = isFinite(opv) ? opv : 0.85
            const peakInfo = (function(){
              if (cfgNow.showPeak === false) return { label: '', color: borderCol, on: false }
              // 官方口径：北京时间 9:00-12:00、14:00-18:00 为高峰，其余为空闲（半价）
              const d = new Date(); const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + 480) % 1440
              const peak = (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60)
              return { label: peak ? '峰时' : '谷时', color: peak ? '#ff5b5b' : '#4cd07d', on: true }
            })()
            const badgeHtml = '<div id="__wb_badge" title="白饭余额" style="position:fixed;left:10px;' +
              'bottom:10px;z-index:99998;padding:3px 10px;border-radius:8px;background:rgba(20,22,28,' + opacity + ');' +
              'color:' + bodyColor + ';font:' + fs + 'px/1.7 -apple-system,sans-serif;font-weight:700;' +
              'border:1.5px solid ' + borderCol + ';cursor:grab;user-select:none;' +
              'touch-action:none;backdrop-filter:blur(4px)">' +
              '<span id="__wb_num">白饭 ' + num + '</span>' +
              '<span id="__wb_tag" style="margin-left:1em">' + peakInfo.label + '</span></div>'
            const tag = badgeHtml + '<script>' + buildBadgeJs(cache.r, readConfig()) + '</script>'
            const at = html.lastIndexOf('</body>')
            return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at)
          } catch { return html }
        }), 'whale-balance: badge tap')
      } catch (e) {
        console.warn('[whale-balance] tapIndex 注册失败:', e.message)
      }
    }
    const handler = async (req, res) => {
      const t0 = Date.now()
      const trace = (stage) => {
        try {
          appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
            new Date().toISOString() + ' ' + (Date.now() - t0) + 'ms ' + stage +
            ' ' + req.method + ' ' + String(req.url) + '\n')
        } catch {}
      }
      trace('enter')
      const send = (code, obj) => {
        trace('send ' + code)
        const body = Buffer.from(JSON.stringify(obj), 'utf8')
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
        res.end(body)
      }
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname
        .replace(/^\/api\/whale-balance/, '')
        .replace(/^\/dsh-wb/, '') || '/'
      const readBody = async () => {
        let raw = ''
        for await (const c of req) raw += c
        try { return JSON.parse(raw || '{}') } catch { return {} }
      }

      if (req.method === 'GET' && path === '/set') {
        const q = url.searchParams
        const patch = {}
        if (q.has('showBadge')) patch.showBadge = q.get('showBadge') === '1'
        if (q.has('injectContext')) patch.injectContext = q.get('injectContext') === '1'
        if (q.has('toolEnabled')) patch.toolEnabled = q.get('toolEnabled') === '1'
        if (q.has('lowWater')) patch.lowWater = Number(q.get('lowWater')) || 0
        if (q.has('injectText')) patch.injectText = String(q.get('injectText'))
        if (q.has('showPeak')) patch.showPeak = q.get('showPeak') === '1'
        if (q.has('fontSize')) patch.fontSize = Number(q.get('fontSize')) || 12
        if (q.has('opacity')) patch.opacity = Number(q.get('opacity'))
        if (q.has('colorNormal')) patch.colorNormal = String(q.get('colorNormal'))
        if (q.has('colorLow')) patch.colorLow = String(q.get('colorLow'))
        const next = writeConfig(patch)
        try {
          appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
            new Date().toISOString() + ' set ' + JSON.stringify(patch) + '\n')
        } catch {}
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(next) + ';', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/cfg.js') {
        const c = readConfig()
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(c).replace(/</g, '\\u003c') +
          ';if(window.__WB_PANEL_SYNC)window.__WB_PANEL_SYNC(window.__WB_CFG);', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/badge-data.js') {
        void fresh(true)
        const cfgNow = readConfig()
        const payload = JSON.stringify({ balance: cache.r || null }).replace(/</g, '\\u003c')
        const cfgOut = JSON.stringify({
          colorNormal: cfgNow.colorNormal || '#4cd07d',
          colorLow: cfgNow.colorLow || '#ff5b5b',
          fontSize: Number(cfgNow.fontSize) || 12,
          opacity: isFinite(Number(cfgNow.opacity)) ? Number(cfgNow.opacity) : 0.85,
          showPeak: cfgNow.showPeak !== false,
          offPeakStart: isFinite(Number(cfgNow.offPeakStart)) ? Number(cfgNow.offPeakStart) : 30,
          offPeakEnd: isFinite(Number(cfgNow.offPeakEnd)) ? Number(cfgNow.offPeakEnd) : 510,
        }).replace(/</g, '\\u003c')
        const js = [
          'window.__WB_DATA=' + payload + ';',
          'window.__WB_CFG=' + cfgOut + ';',
          '(function(){try{',
          'var d=window.__WB_DATA||{};var b=d.balance||d;var C=window.__WB_CFG||{};',
          "var el=document.getElementById('__wb_badge');if(!el)return;",
          "var n=document.getElementById('__wb_num');",
          "if(!n){el.innerHTML='<span id=\"__wb_num\"></span><span id=\"__wb_tag\" style=\"margin-left:1em\"></span>';n=document.getElementById('__wb_num')}",
          "var t=document.getElementById('__wb_tag');",
          'var v=Number(b.balance);',
          "n.textContent='白饭 '+(b.currency||'CNY')+' '+(isFinite(v)?v.toFixed(2):'?');",
          'var _d=new Date();var m=(_d.getUTCHours()*60+_d.getUTCMinutes()+480)%1440;',
          'var peak=(m>=540&&m<720)||(m>=840&&m<1080);',
          'var off=!peak;',
          'var border=b.low?C.colorLow:C.colorNormal;',
          'el.style.borderColor=border;',
          'el.style.color=(C.showPeak===false)?border:(off?"#4cd07d":"#ff5b5b");',
          'el.style.fontSize=(C.fontSize||12)+"px";',
          "el.style.background='rgba(20,22,28,'+C.opacity+')';",
          "if(t)t.textContent=(C.showPeak===false)?'':(off?'谷时':'峰时');",
          '}catch(e){}})();',
        ].join('')
        const body = Buffer.from(js, 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      if (req.method === 'GET' && path === '/set') {
        const q = url.searchParams
        const patch = {}
        if (q.has('showBadge')) patch.showBadge = q.get('showBadge') === '1'
        if (q.has('injectContext')) patch.injectContext = q.get('injectContext') === '1'
        if (q.has('toolEnabled')) patch.toolEnabled = q.get('toolEnabled') === '1'
        if (q.has('lowWater')) patch.lowWater = Number(q.get('lowWater')) || 0
        if (q.has('injectText')) patch.injectText = String(q.get('injectText'))
        if (q.has('showPeak')) patch.showPeak = q.get('showPeak') === '1'
        if (q.has('fontSize')) patch.fontSize = Number(q.get('fontSize')) || 12
        if (q.has('opacity')) patch.opacity = Number(q.get('opacity'))
        if (q.has('colorNormal')) patch.colorNormal = String(q.get('colorNormal'))
        if (q.has('colorLow')) patch.colorLow = String(q.get('colorLow'))
        const next = writeConfig(patch)
        try {
          appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
            new Date().toISOString() + ' set ' + JSON.stringify(patch) + '\n')
        } catch {}
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(next) + ';', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/cfg.js') {
        const c = readConfig()
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(c).replace(/</g, '\\u003c') +
          ';if(window.__WB_PANEL_SYNC)window.__WB_PANEL_SYNC(window.__WB_CFG);', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/badge-data.js') {
        void fresh(true)
        const cfgNow = readConfig()
        const payload = JSON.stringify({ balance: cache.r || null }).replace(/</g, '\\u003c')
        const cfgOut = JSON.stringify({
          colorNormal: cfgNow.colorNormal || '#9fd0ff',
          colorLow: cfgNow.colorLow || '#ff8f6b',
          fontSize: Number(cfgNow.fontSize) || 12,
          opacity: isFinite(Number(cfgNow.opacity)) ? Number(cfgNow.opacity) : 0.85,
          showPeak: cfgNow.showPeak !== false,
        }).replace(/</g, '\\u003c')
        const js = [
          'window.__WB_DATA=' + payload + ';',
          'window.__WB_CFG=' + cfgOut + ';',
          '(function(){try{',
          'var d=window.__WB_DATA||{};',
          'var b=d.balance||d;',
          'var C=window.__WB_CFG||{};',
          "var el=document.getElementById('__wb_badge');",
          'if(!el)return;',
          'el.style.color=b.low?C.colorLow:C.colorNormal;',
          "el.style.fontSize=(C.fontSize||12)+'px';",
          "el.style.background='rgba(20,22,28,'+C.opacity+')';",
          "var n=document.getElementById('__wb_num');",
          "if(!n){el.innerHTML='<span id=\\'__wb_tag\\'></span><span id=\\'__wb_num\\'></span>';n=document.getElementById('__wb_num')}",
          'var v=Number(b.balance);',
          "if(!n){el.textContent='白饭 ?';return}",
          "n.textContent='白饭 '+(b.currency||'CNY')+' '+(isFinite(v)?v.toFixed(2):'?');",
          "var t=document.getElementById('__wb_tag');",
          'var _d=new Date();var m=(_d.getUTCHours()*60+_d.getUTCMinutes()+480)%1440;',
          'var off=m>=30&&m<8*60+30;',
          'if(C.showPeak===false){if(t)t.remove()}',
          "else if(t){t.textContent=off?'谷时':'峰时';t.style.color=off?'#4cd07d':'#ff5b5b'}",
          '}catch(e){}})();',
        ].join('')
        const body = Buffer.from(js, 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/set') {
        const q = url.searchParams
        const patch = {}
        if (q.has('showBadge')) patch.showBadge = q.get('showBadge') === '1'
        if (q.has('injectContext')) patch.injectContext = q.get('injectContext') === '1'
        if (q.has('toolEnabled')) patch.toolEnabled = q.get('toolEnabled') === '1'
        if (q.has('lowWater')) patch.lowWater = Number(q.get('lowWater')) || 0
        if (q.has('injectText')) patch.injectText = String(q.get('injectText'))
        if (q.has('showPeak')) patch.showPeak = q.get('showPeak') === '1'
        if (q.has('fontSize')) patch.fontSize = Number(q.get('fontSize')) || 12
        if (q.has('opacity')) patch.opacity = Number(q.get('opacity'))
        if (q.has('colorNormal')) patch.colorNormal = String(q.get('colorNormal'))
        if (q.has('colorLow')) patch.colorLow = String(q.get('colorLow'))
        const next = writeConfig(patch)
        try {
          appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
            new Date().toISOString() + ' set ' + JSON.stringify(patch) + '\n')
        } catch {}
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(next) + ';', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/cfg.js') {
        const c = readConfig()
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(c).replace(/</g, '\\u003c') +
          ';if(window.__WB_PANEL_SYNC)window.__WB_PANEL_SYNC(window.__WB_CFG);', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/badge-data.js') {
        void fresh(true)
        const cfgNow = readConfig()
        const payload = JSON.stringify({ balance: cache.r || null }).replace(/</g, '\\u003c')
        const cfgOut = JSON.stringify({
          colorNormal: cfgNow.colorNormal || '#9fd0ff',
          colorLow: cfgNow.colorLow || '#ff8f6b',
          fontSize: Number(cfgNow.fontSize) || 12,
          opacity: isFinite(Number(cfgNow.opacity)) ? Number(cfgNow.opacity) : 0.85,
          showPeak: cfgNow.showPeak !== false,
        }).replace(/</g, '\\u003c')
        const js = 'window.__WB_DATA=' + payload + ';window.__WB_CFG=' + cfgOut + ';' +
          '(function(){try{' +
          'var d=window.__WB_DATA||{};var b=d.balance||d;var C=window.__WB_CFG||{};' +
          "var el=document.getElementById('__wb_badge');if(!el)return;" +
          "el.style.color=b.low?C.colorLow:C.colorNormal;" +
          "el.style.fontSize=(C.fontSize||12)+'px';" +
          "el.style.background='rgba(20,22,28,'+C.opacity+')';" +
          "var n=document.getElementById('__wb_num');" +
          "var v=Number(b.balance);" +
          "if(!n){el.textContent='白饭 ?';return}" +
          "n.textContent='白饭 '+((b.currency||'CNY'))+' '+(isFinite(v)?v.toFixed(2):'?');" +
          "var t=document.getElementById('__wb_tag');" +
          "var m=new Date().getHours()*60+new Date().getMinutes();var off=m>=30&&m<8*60+30;" +
          "if(C.showPeak===false){if(t)t.remove()}" +
          "else if(t){t.textContent=off?'谷时':'峰时';t.style.color=off?'#4cd07d':'#ff5b5b'}" +
          '}}catch(e){}})();'
        const body = Buffer.from(js, 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/set') {
        const q = url.searchParams
        const patch = {}
        if (q.has('showBadge')) patch.showBadge = q.get('showBadge') === '1'
        if (q.has('injectContext')) patch.injectContext = q.get('injectContext') === '1'
        if (q.has('toolEnabled')) patch.toolEnabled = q.get('toolEnabled') === '1'
        if (q.has('lowWater')) patch.lowWater = Number(q.get('lowWater')) || 0
        if (q.has('injectText')) patch.injectText = String(q.get('injectText'))
        if (q.has('showPeak')) patch.showPeak = q.get('showPeak') === '1'
        if (q.has('fontSize')) patch.fontSize = Number(q.get('fontSize')) || 12
        if (q.has('opacity')) patch.opacity = Number(q.get('opacity'))
        if (q.has('colorNormal')) patch.colorNormal = String(q.get('colorNormal'))
        if (q.has('colorLow')) patch.colorLow = String(q.get('colorLow'))
        const next = writeConfig(patch)
        try {
          appendFileSync('/sdcard/DeepseekHarness/whale-balance/access.log',
            new Date().toISOString() + ' set ' + JSON.stringify(patch) + '\n')
        } catch {}
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(next) + ';', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/cfg.js') {
        const c = readConfig()
        const body = Buffer.from('window.__WB_CFG=' + JSON.stringify(c).replace(/</g, '\\u003c') +
          ';if(window.__WB_PANEL_SYNC)window.__WB_PANEL_SYNC(window.__WB_CFG);', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && path === '/badge-data.js') {
        void fresh(true)
        const payload = JSON.stringify({ balance: cache.r || null }).replace(/</g, '\\u003c')
        const body = Buffer.from(
          'window.__WB_DATA=' + payload + ';' +
          '(function(){try{' +
          'var d=window.__WB_DATA||{};var b=d.balance||d;var v=Number(b.balance);' +
          "var el=document.getElementById('__wb_badge');" +
          "if(!el){el=document.createElement('div');el.id='__wb_badge';" +
          "el.style.cssText='position:fixed;left:10px;bottom:10px;z-index:99998;padding:3px 9px;" +
          "border-radius:8px;background:rgba(20,22,28,.85);color:#9fd0ff;font:12px/1.7 -apple-system,sans-serif;" +
          "border:1px solid rgba(120,170,255,.35);user-select:none';" +
          "(document.body||document.documentElement).appendChild(el);}" +
          "if(!isFinite(v)){el.textContent='白饭 ?';el.style.color='#ff8f6b';return}" +
          "el.textContent='白饭 '+(b.currency||'CNY')+' '+v.toFixed(2);" +
          "el.style.color=b.low?'#ff8f6b':'#9fd0ff';" +
          '}catch(e){}})();', 'utf8')
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8',
          'content-length': body.length, 'cache-control': 'no-store' })
        res.end(body)
        return
      }

      if (req.method === 'GET' && (path === '/' || path === '/status')) {
        live = readConfig()
        // 只回缓存，绝不在这条请求里等外网 —— 浏览器会等到超时
        if (!cache.r) cache = { at: 0, r: { ok: false, text: '还没查到，稍后刷新' } }
        void fresh(true).catch(() => {})
        return send(200, {
          ok: true, config: live, defaults: DEFAULTS,
          balance: cache.r, configFile: CONFIG_FILE,
        })
      }
      if (req.method === 'POST' && path === '/config') {
        const body = await readBody()
        live = writeConfig(body)
        void fresh(true).catch(() => {})
        return send(200, { ok: true, config: live, balance: cache.r })
      }
      trace('404')
      return send(404, { ok: false })
    }
    try {
      for (const base of ['/api/whale-balance', '/dsh-wb']) {
        ctx.effect(() => server.register({
        kind: 'prefix',
        path: base,
        handler: (req, res) => {
          Promise.resolve(handler(req, res)).catch((e) => {
            try {
              const body = Buffer.from(JSON.stringify({ ok: false, error: e?.message || String(e) }), 'utf8')
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
              res.end(body)
            } catch { /* 已走 */ }
          })
        },
      }), 'whale-balance: api ' + base)
      }
    } catch (e) {
      console.warn('[whale-balance] 路由注册失败:', e.message)
    }
  })
}
