// ============================================================
// StockBot - 한국 주식 자동매매 웹앱
// KIS (한국투자증권) API 연동
// ============================================================

// ─── 전역 상태 ───────────────────────────────────────────────
const STATE = {
  running: false,
  mode: 'paper',           // 'paper' | 'live'
  strategy: 'scalping',
  positions: [],           // [{ticker, name, entryPrice, qty, entryTime, currentPrice, pnlPct}]
  stats: { totalTrades: 0, winTrades: 0, totalProfit: 0, dailyProfit: 0 },
  config: {
    maxPositions: 3,
    positionSizeRatio: 0.30,
    profitTarget: 1.5,
    stopLoss: 1.0,
    scanInterval: 30,
    paperCapital: 5000000,
  },
  paperBalance: 5000000,   // 페이퍼 가용 현금
  scanTimer: null,
  nextScanIn: 0,
  countdownTimer: null,
  profitHistory: [],       // [{time, cumProfit}]
  candidates: [],          // 최근 스캔 후보
};

// API 키 (세션 스토리지)
const KEYS = {
  get appKey()    { return sessionStorage.getItem('kis_app_key') || '' },
  get appSecret() { return sessionStorage.getItem('kis_app_secret') || '' },
  get accountNo() { return sessionStorage.getItem('kis_account_no') || '' },
  save(k, s, a) {
    sessionStorage.setItem('kis_app_key',    k);
    sessionStorage.setItem('kis_app_secret', s);
    sessionStorage.setItem('kis_account_no', a);
  }
};

// API 공통 헤더
function apiHeaders() {
  return {
    'x-app-key':    KEYS.appKey,
    'x-app-secret': KEYS.appSecret,
    'x-account-no': KEYS.accountNo,
  };
}

// ─── 초기화 ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  loadSavedKeys();
  loadConfig();
  renderStrategyConditions();
  updateMarketStatus();
  await loadTradeHistory();
  initProfitChart();
  updateStatsUI();
  renderPosSlots();
  addLog('info', '📈 StockBot 초기화 완료. API 키를 설정하세요.');

  // 주기적 UI 갱신: 포지션 가격 + 총자산 카드
  setInterval(tickPositions, 5000);
  setInterval(updateMarketStatus, 60000);
  // 총자산 숫자 애니메이션용 1초 갱신
  setInterval(updateStatsUI, 1000);
});

// ─── API 설정 모달 ────────────────────────────────────────────
function openApiSettings()  { document.getElementById('api-modal').classList.remove('hidden'); }
function closeApiSettings() { document.getElementById('api-modal').classList.add('hidden'); }

function loadSavedKeys() {
  document.getElementById('input-app-key').value    = KEYS.appKey    ? '●●●●●●●●' : '';
  document.getElementById('input-app-secret').value = KEYS.appSecret ? '●●●●●●●●' : '';
  document.getElementById('input-account-no').value = KEYS.accountNo || '';
}

function saveApiKeys() {
  const k = document.getElementById('input-app-key').value.trim();
  const s = document.getElementById('input-app-secret').value.trim();
  const a = document.getElementById('input-account-no').value.trim();
  if (!k || k === '●●●●●●●●') { showApiResult('⚠️ APP KEY를 입력하세요', 'warn'); return; }
  if (!s || s === '●●●●●●●●') { showApiResult('⚠️ APP SECRET를 입력하세요', 'warn'); return; }
  KEYS.save(k, s, a);
  showApiResult('✅ 저장 완료', 'ok');
  addLog('info', '🔑 API 키 저장 완료');
  setTimeout(closeApiSettings, 800);
}

async function testApiConnection() {
  showApiResult('🔄 연결 테스트 중...', 'info');
  const k = document.getElementById('input-app-key').value.trim();
  const s = document.getElementById('input-app-secret').value.trim();
  if (!k || k === '●●●●●●●●' || !s || s === '●●●●●●●●') {
    showApiResult('⚠️ 키를 먼저 입력하세요', 'warn'); return;
  }
  try {
    const res = await axios.post('/api/auth/token', { appKey: k, appSecret: s });
    if (res.data.ok) {
      showApiResult('✅ 연결 성공! 토큰 발급 완료', 'ok');
      addLog('info', '✅ KIS API 연결 테스트 성공');
    } else {
      showApiResult('❌ 연결 실패: ' + (res.data.error || ''), 'error');
    }
  } catch(e) {
    showApiResult('❌ 오류: ' + (e.response?.data?.error || e.message), 'error');
  }
}

function showApiResult(msg, type) {
  const el = document.getElementById('api-test-result');
  el.textContent = msg;
  el.className = 'text-xs text-center ' + {
    ok: 'text-green-400', warn: 'text-yellow-400', error: 'text-red-400', info: 'text-blue-400'
  }[type];
}

// ─── 모드 / 전략 설정 ─────────────────────────────────────────
function setMode(mode) {
  STATE.mode = mode;
  document.getElementById('mode-paper').classList.toggle('active-mode', mode === 'paper');
  document.getElementById('mode-live').classList.toggle('active-mode', mode === 'live');
  document.getElementById('mode-live').classList.toggle('danger', mode === 'live');
  if (mode === 'live' && !KEYS.appKey) {
    addLog('warn', '⚠️ 실전 모드: API 키를 먼저 설정하세요');
    openApiSettings();
  }
  renderStrategyConditions();
}

function updateSlider(id, labelId, suffix) {
  const val = parseFloat(document.getElementById(id).value);
  document.getElementById(labelId).textContent = val.toFixed(1) + suffix;
  renderStrategyConditions();
}

function updateCapitalSlider() {
  const val = parseInt(document.getElementById('paper-capital').value);
  document.getElementById('paper-capital-val').textContent = val + '00만원';
  document.getElementById('paper-capital-num').value = val;
  STATE.config.paperCapital = val * 1000000;
}

// 숫자 입력 → 슬라이더 동기화
function syncSliderFromNum(sliderId, numId, labelId, suffix) {
  const num = parseFloat(document.getElementById(numId).value);
  const slider = document.getElementById(sliderId);
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const clamped = Math.min(Math.max(num, min), max);
  slider.value = clamped;
  document.getElementById(labelId).textContent = clamped.toFixed(suffix === '개' ? 0 : 1) + suffix;
}

function syncCapitalFromNum() {
  const val = parseInt(document.getElementById('paper-capital-num').value) || 1;
  document.getElementById('paper-capital').value = val;
  document.getElementById('paper-capital-val').textContent = val + '00만원';
  STATE.config.paperCapital = val * 1000000;
}

// 포지션 카드의 +/- 버튼
function changeMaxPos(delta) {
  const cur = STATE.config.maxPositions;
  const next = Math.min(Math.max(cur + delta, 1), 20);
  STATE.config.maxPositions = next;
  document.getElementById('max-positions').value      = next;
  document.getElementById('max-positions-num').value  = next;
  document.getElementById('maxpos-val').textContent   = next + '개';
  document.getElementById('maxpos-display').textContent = next;
  renderPosSlots();
  updateStatsUI();
}

// 포지션 슬롯 시각화 (카드 상단)
function renderPosSlots() {
  const max   = STATE.config.maxPositions;
  const used  = STATE.positions.length;
  const slots = document.getElementById('pos-slots');
  if (!slots) return;
  slots.innerHTML = Array.from({ length: Math.min(max, 20) }).map((_, i) => {
    const filled = i < used;
    return `<span class="w-3 h-3 rounded-sm ${filled ? 'bg-green-500' : 'bg-gray-700'} transition-colors"></span>`;
  }).join('');
}

// maxpos 슬라이더 → 카드 동기화
function syncMaxPosCard() {
  const val = parseInt(document.getElementById('max-positions').value);
  document.getElementById('max-positions-num').value    = val;
  document.getElementById('maxpos-display').textContent = val;
  STATE.config.maxPositions = val;
  renderPosSlots();
  updateStatsUI();
}

function loadConfig() {
  const saved = localStorage.getItem('bot_config');
  if (saved) {
    try {
      const c = JSON.parse(saved);
      Object.assign(STATE.config, c);
    } catch(e) {}
  }
  const p  = STATE.config.profitTarget;
  const sl = STATE.config.stopLoss;
  const mp = STATE.config.maxPositions;
  const pr = Math.round(STATE.config.positionSizeRatio * 100);
  const pc = Math.round(STATE.config.paperCapital / 1000000);

  document.getElementById('profit-target').value      = p;
  document.getElementById('profit-target-num').value  = p;
  document.getElementById('stop-loss').value          = sl;
  document.getElementById('stop-loss-num').value      = sl;
  document.getElementById('max-positions').value      = mp;
  document.getElementById('max-positions-num').value  = mp;
  document.getElementById('pos-ratio').value          = pr;
  document.getElementById('pos-ratio-num').value      = pr;
  document.getElementById('paper-capital').value      = pc;
  document.getElementById('paper-capital-num').value  = pc;
  document.getElementById('strategy-select').value    = localStorage.getItem('bot_strategy') || 'scalping';

  // 레이블 갱신
  document.getElementById('profit-val').textContent        = p + '%';
  document.getElementById('stoploss-val').textContent      = sl + '%';
  document.getElementById('maxpos-val').textContent        = mp + '개';
  document.getElementById('maxpos-display').textContent    = mp;
  document.getElementById('posratio-val').textContent      = pr + '%';
  document.getElementById('paper-capital-val').textContent = pc + '00만원';
}

function saveConfig() {
  STATE.config.profitTarget      = parseFloat(document.getElementById('profit-target').value);
  STATE.config.stopLoss          = parseFloat(document.getElementById('stop-loss').value);
  STATE.config.maxPositions      = parseInt(document.getElementById('max-positions').value);
  STATE.config.positionSizeRatio = parseInt(document.getElementById('pos-ratio').value) / 100;
  STATE.strategy                 = document.getElementById('strategy-select').value;
  localStorage.setItem('bot_config', JSON.stringify(STATE.config));
  localStorage.setItem('bot_strategy', STATE.strategy);
  // 카드 동기화
  document.getElementById('maxpos-display').textContent = STATE.config.maxPositions;
  renderPosSlots();
  addLog('info', `💾 설정 저장 — 최대포지션: ${STATE.config.maxPositions}개, 익절: ${STATE.config.profitTarget}%, 손절: ${STATE.config.stopLoss}%`);
  renderStrategyConditions();
  updateStatsUI();
}

// ─── 전략 조건 표시 ───────────────────────────────────────────
const STRATEGY_META = {
  scalping: {
    name: '⚡ 스캘핑 전략',
    interval: 15,
    conditions: [
      { label: '1분 가격 변동', value: '0.3% ~ 2.0%', color: 'blue' },
      { label: '거래량 증가', value: '1.5배 이상', color: 'green' },
      { label: 'RSI', value: '35 ~ 65', color: 'purple' },
      { label: '매수 압력', value: '1.2배 이상', color: 'yellow' },
    ],
  },
  volume: {
    name: '📊 거래량 급증 전략',
    interval: 30,
    conditions: [
      { label: '거래량 폭증', value: '2.0배 이상', color: 'pink' },
      { label: '가격 모멘텀', value: '0.5% ~ 5%', color: 'blue' },
      { label: 'RSI', value: '70 이하', color: 'purple' },
      { label: '시가총액', value: '1000억 이상 권장', color: 'gray' },
    ],
  },
  momentum: {
    name: '🚀 모멘텀 추종 전략',
    interval: 60,
    conditions: [
      { label: '5일 이동평균 돌파', value: '상향 돌파 시', color: 'green' },
      { label: '거래량 확인', value: '평균 대비 1.3배', color: 'blue' },
      { label: '추세 강도', value: 'ADX ≥ 25', color: 'yellow' },
      { label: '52주 고가 대비', value: '80% 이상', color: 'orange' },
    ],
  },
  mean_reversion: {
    name: '↩️ 평균 회귀 전략',
    interval: 120,
    conditions: [
      { label: '볼린저 밴드', value: '하단 이탈 후 진입', color: 'cyan' },
      { label: 'RSI 과매도', value: '30 이하', color: 'red' },
      { label: '이격도', value: '5일선 -3% 이하', color: 'orange' },
      { label: '시장 상황', value: '횡보/반등 구간', color: 'gray' },
    ],
  },
};

const COLOR_MAP = {
  blue: 'text-blue-400', green: 'text-green-400', purple: 'text-purple-400',
  yellow: 'text-yellow-400', pink: 'text-pink-400', gray: 'text-gray-400',
  red: 'text-red-400', cyan: 'text-cyan-400', orange: 'text-orange-400',
};

function renderStrategyConditions() {
  const strat = document.getElementById('strategy-select')?.value || STATE.strategy;
  const meta  = STRATEGY_META[strat] || STRATEGY_META.scalping;
  STATE.config.scanInterval = meta.interval;
  document.getElementById('bot-interval-label').textContent = meta.interval + '초';

  const profitTarget = parseFloat(document.getElementById('profit-target')?.value || STATE.config.profitTarget);
  const stopLoss     = parseFloat(document.getElementById('stop-loss')?.value     || STATE.config.stopLoss);

  const condEl = document.getElementById('strategy-conditions');
  condEl.innerHTML = meta.conditions.map(c => `
    <div class="flex justify-between items-center bg-gray-800/50 rounded px-2 py-1.5">
      <span class="text-gray-400">${c.label}</span>
      <span class="${COLOR_MAP[c.color] || 'text-gray-300'} font-medium">${c.value}</span>
    </div>
  `).join('');

  const exitEl = document.getElementById('exit-conditions');
  const fee = 0.245;
  exitEl.innerHTML = `
    <div class="flex justify-between"><span class="text-gray-500">✅ 익절</span><span class="text-green-400">+${profitTarget}% (수수료 후 +${(profitTarget - fee).toFixed(2)}%)</span></div>
    <div class="flex justify-between"><span class="text-gray-500">🚨 손절</span><span class="text-red-400">-${stopLoss}% (실제 -${(stopLoss + fee).toFixed(2)}%)</span></div>
    <div class="flex justify-between"><span class="text-gray-500">⏰ 시간 청산</span><span class="text-yellow-400">전략별 최대 보유 시간</span></div>
  `;
}

// ─── 봇 시작 / 정지 ───────────────────────────────────────────
async function toggleBot() {
  if (STATE.running) {
    stopBot();
  } else {
    await startBot();
  }
}

async function startBot() {
  if (STATE.mode === 'live' && !KEYS.appKey) {
    addLog('error', '❌ 실전 모드: API 키가 없습니다');
    openApiSettings();
    return;
  }

  saveConfig();
  STATE.running = true;
  STATE.paperBalance = STATE.config.paperCapital;

  const btn = document.getElementById('bot-toggle-btn');
  btn.innerHTML = '<i class="fas fa-stop mr-2"></i> 봇 정지';
  btn.className = 'w-full py-3 rounded-lg text-base font-bold transition bg-red-600 hover:bg-red-700';
  document.getElementById('bot-running-label').textContent = '🟢 실행 중';
  document.getElementById('bot-running-label').className   = 'text-green-400';

  const modeName = STATE.mode === 'paper' ? '📄 페이퍼' : '🔴 실전';
  const stratName = STRATEGY_META[STATE.strategy]?.name || STATE.strategy;
  addLog('info', `🚀 봇 시작 — 모드: ${modeName} | 전략: ${stratName}`);
  addLog('info', `   익절: +${STATE.config.profitTarget}% | 손절: -${STATE.config.stopLoss}% | 최대포지션: ${STATE.config.maxPositions}개`);

  // 즉시 1회 스캔 후 주기 실행
  await runScan();
  scheduleNextScan();
}

function stopBot() {
  STATE.running = false;
  clearTimeout(STATE.scanTimer);
  clearInterval(STATE.countdownTimer);

  const btn = document.getElementById('bot-toggle-btn');
  btn.innerHTML = '<i class="fas fa-play mr-2"></i> 봇 시작';
  btn.className = 'w-full py-3 rounded-lg text-base font-bold transition bg-green-600 hover:bg-green-700';
  document.getElementById('bot-running-label').textContent = '⭕ 정지';
  document.getElementById('bot-running-label').className   = 'text-gray-400';
  document.getElementById('next-scan-label').textContent   = '-';
  addLog('warn', '⏹️ 봇 정지');
}

function scheduleNextScan() {
  if (!STATE.running) return;
  const interval = STATE.config.scanInterval * 1000;
  STATE.nextScanIn = STATE.config.scanInterval;

  clearInterval(STATE.countdownTimer);
  STATE.countdownTimer = setInterval(() => {
    STATE.nextScanIn--;
    document.getElementById('next-scan-label').textContent = STATE.nextScanIn + '초 후';
    if (STATE.nextScanIn <= 0) clearInterval(STATE.countdownTimer);
  }, 1000);

  STATE.scanTimer = setTimeout(async () => {
    if (!STATE.running) return;
    await runScan();
    scheduleNextScan();
  }, interval);
}

// ─── 메인 스캔 로직 ───────────────────────────────────────────
async function runScan() {
  addLog('scan', `🔍 [스캔] ${STATE.strategy.toUpperCase()} 전략 스캔 시작...`);

  // 1) 포지션 청산 체크 (먼저)
  await checkPositionsForExit();

  // 2) 신규 진입 조건 검색
  if (STATE.positions.length < STATE.config.maxPositions) {
    await scanForEntries();
  } else {
    addLog('scan', `   📊 포지션 최대 (${STATE.positions.length}/${STATE.config.maxPositions}) — 진입 스킵`);
  }

  updateStatsUI();
  renderPositions();
}

// 포지션 청산 체크
async function checkPositionsForExit() {
  for (let i = STATE.positions.length - 1; i >= 0; i--) {
    const pos = STATE.positions[i];
    const currentPrice = await fetchCurrentPrice(pos.ticker);
    if (!currentPrice) continue;

    pos.currentPrice = currentPrice;
    const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const netPnlPct = pnlPct - 0.245; // 수수료 차감
    pos.pnlPct = pnlPct;

    const holdSec = (Date.now() - pos.entryTime) / 1000;

    let exitReason = null;

    // 익절
    if (pnlPct >= STATE.config.profitTarget) {
      exitReason = `익절 +${pnlPct.toFixed(2)}%`;
    }
    // 손절
    else if (pnlPct <= -STATE.config.stopLoss) {
      exitReason = `손절 ${pnlPct.toFixed(2)}%`;
    }
    // 시간 청산 (전략별)
    else {
      const maxHold = { scalping: 900, volume: 1800, momentum: 3600, mean_reversion: 7200 }[STATE.strategy] || 1800;
      if (holdSec >= maxHold && pnlPct > 0.1) {
        exitReason = `시간청산 (${Math.round(holdSec/60)}분 경과) +${pnlPct.toFixed(2)}%`;
      }
    }

    if (exitReason) {
      await executeExit(pos, exitReason, netPnlPct);
      STATE.positions.splice(i, 1);
    }
  }
}

// 매도 실행
async function executeExit(pos, reason, netPnlPct) {
  const investAmt = pos.entryPrice * pos.qty;
  const profitAmt = Math.round(investAmt * netPnlPct / 100);
  const isWin = netPnlPct > 0;

  if (STATE.mode === 'live') {
    try {
      await axios.post('/api/trade/order', {
        ticker: pos.ticker, qty: pos.qty, price: pos.currentPrice, side: 'sell', priceType: 'market'
      }, { headers: apiHeaders() });
    } catch(e) {
      addLog('error', `❌ 매도 API 실패: ${pos.ticker} — ${e.message}`);
    }
  } else {
    // 페이퍼: 현금 반환
    STATE.paperBalance += Math.round(investAmt + profitAmt);
  }

  STATE.stats.totalTrades++;
  if (isWin) STATE.stats.winTrades++;
  STATE.stats.totalProfit += profitAmt;
  STATE.stats.dailyProfit += profitAmt;

  STATE.profitHistory.push({ time: new Date().toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'}), cumProfit: STATE.stats.totalProfit });
  updateProfitChart();

  const icon = isWin ? '✅' : '🚨';
  const color = isWin ? 'profit' : 'loss';
  addLog(color, `${icon} 매도 완료: ${pos.name || pos.ticker} — ${reason}`);
  addLog(color, `   진입 ${fmtPrice(pos.entryPrice)} → 청산 ${fmtPrice(pos.currentPrice)} | 손익 ${profitAmt > 0 ? '+' : ''}${fmtPrice(profitAmt)}원 (${netPnlPct > 0 ? '+' : ''}${netPnlPct.toFixed(2)}%)`);

  // 거래 기록
  await recordTrade({
    ticker: pos.ticker,
    name: pos.name || pos.ticker,
    side: 'sell',
    entryPrice: pos.entryPrice,
    exitPrice: pos.currentPrice,
    qty: pos.qty,
    pnlPct: netPnlPct,
    profitAmt,
    reason,
    timestamp: new Date().toISOString(),
    mode: STATE.mode,
  });
  await loadTradeHistory();
}

// 신규 진입 스캔
async function scanForEntries() {
  const candidates = await generateCandidates();
  STATE.candidates = candidates;
  addLog('scan', `   후보 ${candidates.length}개 발견`);

  for (const c of candidates) {
    if (STATE.positions.length >= STATE.config.maxPositions) break;
    if (STATE.positions.find(p => p.ticker === c.ticker)) continue;

    await executeEntry(c);
  }
}

// 후보 종목 생성 (전략별 모의 스캔)
async function generateCandidates() {
  const strategy = document.getElementById('strategy-select').value || STATE.strategy;

  // KIS API가 있으면 거래량 순위에서 가져오기
  if (KEYS.appKey) {
    try {
      const res = await axios.get('/api/stock/volume-rank', { headers: apiHeaders(), timeout: 8000 });
      const items = res.data?.output || [];
      const filtered = items.slice(0, 20).filter(item => {
        const pctChange = parseFloat(item.prdy_ctrt || 0);
        const vol       = parseFloat(item.acml_vol || 0);
        if (strategy === 'scalping')       return pctChange > 0.3  && pctChange < 3.0;
        if (strategy === 'volume')         return vol > 1000000;
        if (strategy === 'momentum')       return pctChange > 1.0;
        if (strategy === 'mean_reversion') return pctChange < -1.5;
        return true;
      });

      return filtered.slice(0, 5).map(item => ({
        ticker:    item.mksc_shrn_iscd,
        name:      item.hts_kor_isnm || item.mksc_shrn_iscd,
        price:     parseFloat(item.stck_prpr || 0),
        pctChange: parseFloat(item.prdy_ctrt || 0),
        volume:    parseFloat(item.acml_vol || 0),
        score:     Math.random() * 30 + 70,
      }));
    } catch(e) {
      addLog('warn', '⚠️ 거래량 순위 조회 실패 — 시뮬레이션 사용');
    }
  }

  // API 없거나 실패 시 시뮬레이션 종목
  return generateSimCandidates(strategy);
}

function generateSimCandidates(strategy) {
  const STOCKS = [
    { ticker: '005930', name: '삼성전자',     basePrice: 78000 },
    { ticker: '000660', name: 'SK하이닉스',   basePrice: 195000 },
    { ticker: '035420', name: 'NAVER',        basePrice: 235000 },
    { ticker: '005380', name: '현대차',       basePrice: 265000 },
    { ticker: '051910', name: 'LG화학',       basePrice: 380000 },
    { ticker: '006400', name: '삼성SDI',      basePrice: 370000 },
    { ticker: '035720', name: '카카오',       basePrice: 48000 },
    { ticker: '068270', name: '셀트리온',     basePrice: 195000 },
    { ticker: '207940', name: '삼성바이오로직스', basePrice: 980000 },
    { ticker: '003670', name: '포스코홀딩스', basePrice: 375000 },
  ];

  const results = [];
  const shuffled = [...STOCKS].sort(() => Math.random() - 0.5);

  for (const s of shuffled.slice(0, 8)) {
    const pctChange  = (Math.random() - 0.3) * 4;
    const volMult    = 1 + Math.random() * 3;
    const rsi        = 30 + Math.random() * 50;
    const buyPressure = 0.8 + Math.random() * 0.8;

    let pass = false;
    if (strategy === 'scalping')       pass = pctChange > 0.3 && pctChange < 2.0 && rsi > 35 && rsi < 65 && buyPressure > 1.2;
    if (strategy === 'volume')         pass = volMult > 2.0 && pctChange > 0.5 && rsi < 70;
    if (strategy === 'momentum')       pass = pctChange > 1.0 && volMult > 1.3;
    if (strategy === 'mean_reversion') pass = pctChange < -1.5 && rsi < 35;

    if (pass) {
      const price = s.basePrice * (1 + pctChange / 100);
      results.push({
        ticker:    s.ticker,
        name:      s.name,
        price:     Math.round(price),
        pctChange: parseFloat(pctChange.toFixed(2)),
        volume:    Math.round(1000000 * volMult),
        rsi:       parseFloat(rsi.toFixed(1)),
        buyPressure: parseFloat(buyPressure.toFixed(2)),
        score:     Math.round(50 + Math.random() * 40),
      });
    }
  }
  return results;
}

// 매수 실행
async function executeEntry(candidate) {
  const available = STATE.mode === 'paper' ? STATE.paperBalance : await getLiveBalance();
  if (available < 10000) {
    addLog('warn', `⚠️ 가용 자금 부족: ${fmtPrice(available)}원`);
    return;
  }

  const investAmt = Math.min(
    Math.round(available * STATE.config.positionSizeRatio),
    available
  );

  if (investAmt < 10000) return;

  const price = candidate.price || 1;
  const qty   = Math.floor(investAmt / price);
  if (qty < 1) return;

  if (STATE.mode === 'live') {
    try {
      await axios.post('/api/trade/order', {
        ticker: candidate.ticker, qty, price: candidate.price, side: 'buy', priceType: 'market'
      }, { headers: apiHeaders() });
    } catch(e) {
      addLog('error', `❌ 매수 API 실패: ${candidate.ticker} — ${e.message}`);
      return;
    }
  } else {
    STATE.paperBalance -= qty * price;
  }

  const pos = {
    ticker:       candidate.ticker,
    name:         candidate.name || candidate.ticker,
    entryPrice:   candidate.price,
    qty,
    entryTime:    Date.now(),
    currentPrice: candidate.price,
    pnlPct:       0,
    score:        candidate.score,
  };
  STATE.positions.push(pos);

  addLog('buy', `💰 매수: ${pos.name} (${pos.ticker})`);
  addLog('buy', `   진입가 ${fmtPrice(pos.entryPrice)}원 | ${qty}주 | 투자 ${fmtPrice(qty * price)}원`);
  renderPositions();
  updateStatsUI(); // 매수 즉시 총자산 카드 반영
}

// ─── 실시간 포지션 가격 업데이트 ──────────────────────────────
async function tickPositions() {
  if (STATE.positions.length === 0) return;

  for (const pos of STATE.positions) {
    const price = await fetchCurrentPrice(pos.ticker);
    if (price) {
      pos.currentPrice = price;
      pos.pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
    }
  }
  renderPositions();
  updateStatsUI(); // 포지션 가격 변동 → 총자산 카드 즉시 반영
}

async function fetchCurrentPrice(ticker) {
  if (STATE.mode === 'live' && KEYS.appKey) {
    try {
      const res = await axios.get(`/api/stock/price/${ticker}`, { headers: apiHeaders(), timeout: 4000 });
      return parseFloat(res.data?.output?.stck_prpr || 0) || null;
    } catch { return null; }
  }
  // 페이퍼: 시뮬레이션 가격 (소폭 랜덤 변동)
  const pos = STATE.positions.find(p => p.ticker === ticker);
  if (!pos) return null;
  const drift = (Math.random() - 0.48) * pos.entryPrice * 0.003;
  return Math.round(pos.currentPrice + drift);
}

async function getLiveBalance() {
  try {
    const res = await axios.get('/api/account/balance', { headers: apiHeaders(), timeout: 5000 });
    return parseFloat(res.data?.output2?.[0]?.dnca_tot_amt || 0);
  } catch { return 0; }
}

// ─── 포지션 UI 렌더링 ─────────────────────────────────────────
function renderPositions() {
  const el = document.getElementById('positions-list');
  document.getElementById('stat-positions').textContent =
    `${STATE.positions.length} / ${STATE.config.maxPositions}`;

  if (STATE.positions.length === 0) {
    el.innerHTML = '<div class="text-gray-600 text-sm text-center py-8">포지션 없음<br><span class="text-xs">봇을 시작하면 자동으로 종목을 매수합니다</span></div>';
    return;
  }

  el.innerHTML = STATE.positions.map(pos => {
    const netPnl = pos.pnlPct - 0.245;
    const isProfit = netPnl >= 0;
    const holdMin  = Math.floor((Date.now() - pos.entryTime) / 60000);
    const holdSec  = Math.floor(((Date.now() - pos.entryTime) % 60000) / 1000);
    const pnlAmt   = Math.round(pos.entryPrice * pos.qty * netPnl / 100);
    const bar      = Math.min(Math.abs(pos.pnlPct) / STATE.config.profitTarget * 100, 100);

    return `
    <div class="position-card ${isProfit ? 'profit' : 'loss'}">
      <div class="flex justify-between items-start mb-1">
        <div>
          <span class="font-medium text-sm text-white">${pos.name}</span>
          <span class="text-gray-500 text-xs ml-1">${pos.ticker}</span>
        </div>
        <div class="text-right">
          <div class="${isProfit ? 'text-profit' : 'text-loss'} font-bold text-sm">
            ${pos.pnlPct >= 0 ? '+' : ''}${pos.pnlPct.toFixed(2)}%
          </div>
          <div class="text-xs ${isProfit ? 'text-green-500' : 'text-red-500'}">
            ${pnlAmt >= 0 ? '+' : ''}${fmtPrice(pnlAmt)}원
          </div>
        </div>
      </div>
      <div class="text-xs text-gray-500 flex justify-between">
        <span>진입 ${fmtPrice(pos.entryPrice)} → 현재 ${fmtPrice(pos.currentPrice)}</span>
        <span>${holdMin}분 ${holdSec}초</span>
      </div>
      <div class="mt-1.5 h-1 bg-gray-800 rounded">
        <div class="h-1 rounded ${isProfit ? 'bg-green-500' : 'bg-red-500'}" style="width:${bar}%"></div>
      </div>
      <div class="text-xs text-gray-600 mt-0.5">익절까지 ${Math.max(0, (STATE.config.profitTarget - pos.pnlPct)).toFixed(2)}%</div>
    </div>`;
  }).join('');
}

function refreshPositions() {
  tickPositions();
  addLog('info', '🔄 포지션 수동 새로고침');
}

// ─── 거래 내역 ────────────────────────────────────────────────
async function recordTrade(trade) {
  try { await axios.post('/api/trades', trade, { headers: apiHeaders() }); } catch { }
  const saved = JSON.parse(localStorage.getItem('trade_history') || '[]');
  saved.unshift(trade);
  localStorage.setItem('trade_history', JSON.stringify(saved.slice(0, 200)));
}

async function loadTradeHistory() {
  let trades = JSON.parse(localStorage.getItem('trade_history') || '[]');
  try {
    const res = await axios.get('/api/trades', { headers: apiHeaders(), timeout: 3000 });
    if (Array.isArray(res.data) && res.data.length > 0) trades = res.data;
  } catch { }
  renderTradeHistory(trades);
}

function renderTradeHistory(trades) {
  const tbody = document.getElementById('trades-tbody');
  if (!trades || trades.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-600 py-6">거래 내역 없음</td></tr>';
    return;
  }

  tbody.innerHTML = trades.slice(0, 30).map(t => {
    const isWin = t.pnlPct > 0;
    const pnlText = `${t.pnlPct >= 0 ? '+' : ''}${parseFloat(t.pnlPct || 0).toFixed(2)}%`;
    return `<tr class="text-xs">
      <td class="py-1.5 text-white">${t.name || t.ticker}</td>
      <td class="py-1.5 text-right text-gray-400">${fmtPrice(t.entryPrice)}</td>
      <td class="py-1.5 text-right text-gray-400">${fmtPrice(t.exitPrice)}</td>
      <td class="py-1.5 text-right ${isWin ? 'text-green-400' : 'text-red-400'}">${pnlText}</td>
      <td class="py-1.5 text-right">
        <span class="px-1.5 py-0.5 rounded text-xs ${isWin ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}">
          ${isWin ? '익절' : '손절'}
        </span>
      </td>
    </tr>`;
  }).join('');
}

async function clearTrades() {
  if (!confirm('거래 내역을 모두 삭제할까요?')) return;
  localStorage.removeItem('trade_history');
  renderTradeHistory([]);
  addLog('warn', '🗑️ 거래 내역 삭제');
}

// ─── 통계 UI ─────────────────────────────────────────────────
function updateStatsUI() {
  const { totalTrades, winTrades, totalProfit, dailyProfit } = STATE.stats;
  const winRate = totalTrades > 0 ? Math.round((winTrades / totalTrades) * 100) : 0;
  const maxPos  = STATE.config.maxPositions;
  const curPos  = STATE.positions.length;

  // ── 총 자산 카드 (실시간 반영) ──────────────────────
  // 보유 주식 현재 평가금
  const stockVal = STATE.positions.reduce((sum, p) => sum + (p.currentPrice * p.qty), 0);
  // 미실현 손익 (수수료 차감 전)
  const unrealizedPnl = STATE.positions.reduce((sum, p) => {
    const pnl = (p.currentPrice - p.entryPrice) * p.qty;
    return sum + pnl;
  }, 0);

  if (STATE.mode === 'paper') {
    const totalAsset = STATE.paperBalance + stockVal;
    const initialCap = STATE.config.paperCapital;
    // 총자산 표시
    document.getElementById('stat-total-asset').textContent = fmtPrice(totalAsset) + '원';
    // 자산 변동 색상
    const assetEl = document.getElementById('stat-total-asset');
    const assetDiff = totalAsset - initialCap;
    assetEl.className = 'text-2xl font-bold ' + (assetDiff >= 0 ? 'text-white' : 'text-red-300') + ' tracking-tight';
    // 현금 / 주식평가
    document.getElementById('stat-cash').textContent        = fmtPrice(STATE.paperBalance) + '원';
    document.getElementById('stat-stock-value').textContent = stockVal > 0 ? fmtPrice(stockVal) + '원' : '없음';
    // 배지
    document.getElementById('stat-asset-badge').textContent = '페이퍼';
    // 진행 바: 현재자산 / 초기자산 비율
    const barPct = Math.min((totalAsset / Math.max(initialCap, 1)) * 100, 200);
    const barEl  = document.getElementById('stat-asset-bar');
    barEl.style.width      = Math.min(barPct, 100) + '%';
    barEl.className = 'h-0.5 rounded transition-all duration-500 ' + (assetDiff >= 0 ? 'bg-green-500' : 'bg-red-500');
  } else {
    document.getElementById('stat-total-asset').textContent = stockVal > 0 ? '평가 ' + fmtPrice(stockVal) + '원' : '계좌 조회 필요';
    document.getElementById('stat-cash').textContent        = '잔고 조회 필요';
    document.getElementById('stat-stock-value').textContent = stockVal > 0 ? fmtPrice(stockVal) + '원' : '-';
    document.getElementById('stat-asset-badge').textContent = '실전';
    document.getElementById('stat-asset-badge').className   = 'text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-400';
  }

  // ── 오늘 손익 카드 ──────────────────────────────────
  const dailyEl   = document.getElementById('stat-daily-profit');
  dailyEl.textContent = (dailyProfit >= 0 ? '+' : '') + fmtPrice(dailyProfit) + '원';
  dailyEl.className   = 'text-2xl font-bold ' + (dailyProfit >= 0 ? 'text-profit' : 'text-loss');
  const dailyRate = STATE.config.paperCapital > 0 ? (dailyProfit / STATE.config.paperCapital * 100).toFixed(2) : '0.00';
  document.getElementById('stat-daily-rate').textContent = (dailyProfit >= 0 ? '+' : '') + dailyRate + '%';
  // 미실현 손익
  const unrEl = document.getElementById('stat-unrealized');
  unrEl.textContent = (unrealizedPnl >= 0 ? '+' : '') + fmtPrice(unrealizedPnl) + '원';
  unrEl.className   = unrealizedPnl >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium';

  // ── 누적 손익 카드 ──────────────────────────────────
  const profitEl = document.getElementById('stat-total-profit');
  profitEl.textContent = (totalProfit >= 0 ? '+' : '') + fmtPrice(totalProfit) + '원';
  profitEl.className   = 'text-2xl font-bold ' + (totalProfit >= 0 ? 'text-profit' : 'text-loss');
  document.getElementById('stat-win-rate').textContent = winRate + '%';
  document.getElementById('stat-trades').textContent   = totalTrades + '회';

  // ── 포지션 카드 ─────────────────────────────────────
  document.getElementById('stat-positions').textContent = `${curPos} / ${maxPos}`;
  document.getElementById('stat-slots-left').textContent = `${Math.max(maxPos - curPos, 0)}개 여유`;
  document.getElementById('stat-slots-left').className   =
    (maxPos - curPos) > 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium';
  document.getElementById('maxpos-display').textContent  = maxPos;
  renderPosSlots();
}

// ─── 차트 ─────────────────────────────────────────────────────
let profitChart = null;

function initProfitChart() {
  const ctx = document.getElementById('profit-chart').getContext('2d');
  profitChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels:   ['시작'],
      datasets: [{
        label: '누적 손익 (원)',
        data:  [0],
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.08)',
        borderWidth: 2,
        pointRadius: 3,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: '#1f2937' } },
        y: { ticks: { color: '#6b7280', font: { size: 10 }, callback: v => fmtPrice(v) + '원' }, grid: { color: '#1f2937' } },
      },
    },
  });
}

function updateProfitChart() {
  if (!profitChart) return;
  const history = STATE.profitHistory.slice(-30);
  profitChart.data.labels   = ['시작', ...history.map(h => h.time)];
  profitChart.data.datasets[0].data = [0, ...history.map(h => h.cumProfit)];
  profitChart.data.datasets[0].borderColor = STATE.stats.totalProfit >= 0 ? '#22c55e' : '#ef4444';
  profitChart.update();
}

// ─── 종목 스캐너 UI ───────────────────────────────────────────
async function lookupStock() {
  const ticker = document.getElementById('ticker-input').value.trim().replace(/\s/g, '');
  if (!ticker || ticker.length < 4) { addLog('warn', '⚠️ 올바른 종목코드를 입력하세요'); return; }

  const el = document.getElementById('scanner-result');
  el.innerHTML = '<div class="col-span-full text-gray-500 text-sm text-center py-4">🔄 조회 중...</div>';

  if (KEYS.appKey) {
    try {
      const res = await axios.get(`/api/stock/price/${ticker}`, { headers: apiHeaders(), timeout: 5000 });
      const d = res.data?.output;
      if (d) {
        const pct = parseFloat(d.prdy_ctrt || 0);
        el.innerHTML = `
          <div class="scanner-card col-span-2">
            <div class="flex justify-between">
              <span class="font-medium text-white text-sm">${d.hts_kor_isnm || ticker}</span>
              <span class="text-xs text-gray-500">${ticker}</span>
            </div>
            <div class="text-lg font-bold text-white mt-1">${fmtPrice(parseFloat(d.stck_prpr))}원</div>
            <div class="${pct >= 0 ? 'text-green-400' : 'text-red-400'} text-sm">${pct >= 0 ? '+' : ''}${pct}%</div>
            <div class="text-xs text-gray-500 mt-1">거래량 ${fmtVolume(d.acml_vol)}</div>
          </div>`;
        addLog('info', `🔍 ${d.hts_kor_isnm || ticker}: ${fmtPrice(parseFloat(d.stck_prpr))}원 (${pct >= 0 ? '+' : ''}${pct}%)`);
        return;
      }
    } catch(e) {
      addLog('warn', '⚠️ 종목 조회 실패 — ' + e.message);
    }
  } else {
    addLog('warn', '⚠️ API 키를 설정하면 실시간 조회 가능');
  }
  el.innerHTML = '<div class="col-span-full text-gray-600 text-sm text-center py-4">API 키 설정 후 조회 가능합니다</div>';
}

async function loadVolumeRank() {
  const el = document.getElementById('scanner-result');
  el.innerHTML = '<div class="col-span-full text-gray-500 text-sm text-center py-4">🔄 거래량 상위 조회 중...</div>';

  if (KEYS.appKey) {
    try {
      const res = await axios.get('/api/stock/volume-rank', { headers: apiHeaders(), timeout: 8000 });
      const items = (res.data?.output || []).slice(0, 12);
      if (items.length > 0) {
        el.innerHTML = items.map(item => {
          const pct = parseFloat(item.prdy_ctrt || 0);
          return `
          <div class="scanner-card" onclick="document.getElementById('ticker-input').value='${item.mksc_shrn_iscd}'; lookupStock()">
            <div class="font-medium text-white text-xs truncate">${item.hts_kor_isnm}</div>
            <div class="text-sm font-bold text-white mt-0.5">${fmtPrice(parseFloat(item.stck_prpr))}원</div>
            <div class="${pct >= 0 ? 'text-green-400' : 'text-red-400'} text-xs">${pct >= 0 ? '+' : ''}${pct}%</div>
            <div class="text-xs text-gray-600 mt-0.5">거래량 ${fmtVolume(item.acml_vol)}</div>
          </div>`;
        }).join('');
        addLog('info', `📊 거래량 상위 ${items.length}개 로드 완료`);
        return;
      }
    } catch(e) {
      addLog('warn', '⚠️ 거래량 순위 조회 실패');
    }
  }

  // 시뮬레이션 데이터
  const SIM_STOCKS = [
    { ticker: '005930', name: '삼성전자', price: 78000, pct: 1.2, vol: 25000000 },
    { ticker: '000660', name: 'SK하이닉스', price: 195000, pct: -0.8, vol: 8000000 },
    { ticker: '035420', name: 'NAVER', price: 235000, pct: 2.1, vol: 3000000 },
    { ticker: '005380', name: '현대차', price: 265000, pct: 0.5, vol: 2500000 },
    { ticker: '051910', name: 'LG화학', price: 380000, pct: -1.5, vol: 1800000 },
    { ticker: '035720', name: '카카오', price: 48000, pct: 3.2, vol: 15000000 },
    { ticker: '068270', name: '셀트리온', price: 195000, pct: 1.8, vol: 2200000 },
    { ticker: '003670', name: '포스코홀딩스', price: 375000, pct: -0.3, vol: 1200000 },
    { ticker: '207940', name: '삼성바이오로직스', price: 980000, pct: 0.9, vol: 500000 },
    { ticker: '006400', name: '삼성SDI', price: 370000, pct: -2.1, vol: 900000 },
  ];
  el.innerHTML = SIM_STOCKS.map(s => `
    <div class="scanner-card" onclick="document.getElementById('ticker-input').value='${s.ticker}'">
      <div class="font-medium text-white text-xs truncate">${s.name}</div>
      <div class="text-sm font-bold text-white mt-0.5">${fmtPrice(s.price)}원</div>
      <div class="${s.pct >= 0 ? 'text-green-400' : 'text-red-400'} text-xs">${s.pct >= 0 ? '+' : ''}${s.pct}%</div>
      <div class="text-xs text-gray-600 mt-0.5">거래량 ${fmtVolume(s.vol)}</div>
      <div class="text-xs text-yellow-600 mt-0.5">[시뮬레이션]</div>
    </div>
  `).join('');
  addLog('info', '📊 시뮬레이션 거래량 데이터 표시 중 (API 키 설정 시 실시간)');
}

// ─── 장 상태 ──────────────────────────────────────────────────
function updateMarketStatus() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const day = now.getDay(); // 0=일, 6=토
  const dot   = document.getElementById('market-dot');
  const label = document.getElementById('market-label');

  const isWeekday = day >= 1 && day <= 5;
  const inSession = isWeekday && ((h === 9 && m >= 0) || (h > 9 && h < 15) || (h === 15 && m <= 30));
  const preOpen   = isWeekday && h === 8 && m >= 30;
  const afterHour = isWeekday && ((h === 15 && m > 30) || (h >= 16 && h < 18));

  if (inSession) {
    dot.className   = 'w-2 h-2 rounded-full bg-green-500 running-indicator';
    label.textContent = '🟢 정규장 (09:00~15:30)';
    label.className = 'text-green-400 text-sm';
  } else if (preOpen) {
    dot.className   = 'w-2 h-2 rounded-full bg-yellow-400';
    label.textContent = '🟡 장 전 시간외 (08:30~09:00)';
    label.className = 'text-yellow-400 text-sm';
  } else if (afterHour) {
    dot.className   = 'w-2 h-2 rounded-full bg-blue-400';
    label.textContent = '🔵 장 후 시간외 (15:30~18:00)';
    label.className = 'text-blue-400 text-sm';
  } else {
    dot.className   = 'w-2 h-2 rounded-full bg-gray-500';
    label.textContent = `⚫ 장 마감 (다음 개장 ${getNextOpenStr()})`;
    label.className = 'text-gray-400 text-sm';
  }
}

function getNextOpenStr() {
  const now = new Date();
  const d = now.getDay();
  let daysUntil = d === 0 ? 1 : d === 6 ? 2 : 1;
  const next = new Date(now);
  next.setDate(next.getDate() + daysUntil);
  next.setHours(9, 0, 0, 0);
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${mm}/${dd} 09:00`;
}

// ─── 로그 ────────────────────────────────────────────────────
function addLog(type, msg) {
  const el = document.getElementById('log-area');
  const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const colorClass = {
    info: 'log-info', warn: 'log-warn', error: 'log-error',
    buy: 'log-buy', sell: 'log-sell', scan: 'log-scan',
    profit: 'log-profit', loss: 'log-loss',
  }[type] || 'log-info';

  const line = document.createElement('div');
  line.className = colorClass;
  line.textContent = `[${time}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;

  // 최대 300줄 유지
  while (el.children.length > 300) el.removeChild(el.firstChild);
}

function clearLog() { document.getElementById('log-area').innerHTML = ''; }

// ─── 유틸 ─────────────────────────────────────────────────────
function fmtPrice(n) {
  if (n == null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtVolume(n) {
  const v = parseFloat(n || 0);
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '억';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '만';
  return v.toLocaleString('ko-KR');
}
