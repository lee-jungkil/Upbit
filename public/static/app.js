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
    positionSizeRatio: 0.30,   // 레거시 (사용 안 함, 호환성 보존)
    profitTarget: 1.5,
    stopLoss: 1.0,
    scanInterval: 30,
    paperCapital: 5000000,
    posMinAmt: 50000,          // 포지션 최솟값 (원)
    posMaxAmt: 150000,         // 포지션 최댓값 (원, 상한율 적용 전 기본)
    posCapMult: 1.0,           // 상한율 배수 (1.0 ~ 5.0)
  },
  paperBalance: 5000000,   // 페이퍼 가용 현금
  scanTimer: null,
  nextScanIn: 0,
  countdownTimer: null,
  profitHistory: [],       // [{time, cumProfit}]
  candidates: [],          // 최근 스캔 후보
  // ── 적응형 진입 조건 ───────────────────────────────────
  adaptiveMode: 1,         // 0=공격 1=기본 2=방어 3=대기
  recentResults: [],       // 최근 10회 거래 결과 [{win:bool, pnlPct}]
  // ── 내부 플래그 ────────────────────────────────────────
  _lastMarketClosedLog: 0, // 장 외 안내 로그 마지막 출력 타임스탬프
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
  loadConfig();           // 저장된 범위 복원 or 기본값 자동 계산 포함
  renderStrategyConditions();
  updateMarketStatus();
  await loadTradeHistory();
  initProfitChart();
  updateStatsUI();
  renderPosSlots();
  updateAdaptiveBadge();
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

/**
 * KIS 직접 토큰 발급 (브라우저 → KIS 서버 직접 호출)
 * 서버 샌드박스에서는 KIS IP가 차단되므로 브라우저에서 직접 호출합니다.
 */
async function kisDirectFetchToken(appKey, appSecret) {
  const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`KIS HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error(data.msg1 || data.message || JSON.stringify(data).slice(0, 120));
  return data.access_token;
}

/** KIS 토큰 반환 (캐시 → 직접 발급) */
async function getKisToken() {
  const cached = sessionStorage.getItem('kis_token_cached');
  const exp    = parseInt(sessionStorage.getItem('kis_token_exp') || '0');
  if (cached && Date.now() < exp) return cached;
  const token = await kisDirectFetchToken(KEYS.appKey, KEYS.appSecret);
  sessionStorage.setItem('kis_token_cached', token);
  sessionStorage.setItem('kis_token_exp', String(Date.now() + 82800 * 1000)); // 23h
  return token;
}

async function testApiConnection() {
  showApiResult('🔄 브라우저에서 KIS 직접 연결 테스트 중...', 'info');
  const k = document.getElementById('input-app-key').value.trim();
  const s = document.getElementById('input-app-secret').value.trim();
  if (!k || k === '●●●●●●●●' || !s || s === '●●●●●●●●') {
    showApiResult('⚠️ 키를 먼저 입력하세요', 'warn'); return;
  }
  try {
    // 1단계: KIS 토큰 직접 발급 (브라우저 → KIS)
    const token = await kisDirectFetchToken(k, s);
    sessionStorage.setItem('kis_token_cached', token);
    sessionStorage.setItem('kis_token_exp', String(Date.now() + 82800 * 1000));
    showApiResult('✅ KIS 연결 성공! 토큰 발급 완료 (브라우저 직접 호출)', 'ok');
    addLog('info', '✅ KIS API 연결 성공 — 브라우저 직접 호출 모드');

    // 2단계: 네이버 프록시 현재가 테스트
    const nr = await axios.get('/api/naver/price/005930', { timeout: 5000 });
    if (nr.data?.ok) {
      addLog('info', `📊 네이버 시세 연동 OK — 삼성전자 ${nr.data.price?.toLocaleString()}원`);
    }
  } catch(e) {
    // CORS 에러인 경우 안내
    const msg = e.message || String(e);
    if (msg.includes('CORS') || msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
      showApiResult('❌ CORS 차단 — KIS Developer 앱 설정에서 접속 IP를 등록하세요', 'error');
      addLog('error', '❌ KIS CORS 차단: KIS Developer → 앱 설정 → "접속 허용 IP" 또는 "CORS" 항목에 현재 IP 등록 필요');
    } else {
      showApiResult('❌ 오류: ' + msg.slice(0, 80), 'error');
      addLog('error', '❌ KIS 연결 실패: ' + msg);
    }
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
  // 자본금 바뀌면 포지션 범위 미리보기 갱신 (강제 리셋 X — 사용자 수동 값 보존)
  applyDefaultPositionRange(STATE.config.paperCapital, false);
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
  // 자본금 바뀌면 포지션 범위 기본값도 미리보기 갱신
  applyDefaultPositionRange(STATE.config.paperCapital, false);
}

// ─── 포지션 금액 범위 ─────────────────────────────────────────

/**
 * 자본금에서 기본 min/max 계산
 * 기본 비율: min = 자본금×10%, max = 자본금×30%
 * 500만 → 50만/150만 | 1000만 → 100만/300만
 */
function calcDefaultRange(capital) {
  const minAmt = Math.round(capital * 0.10 / 10000) * 10000;   // 10% 단위 만원
  const maxAmt = Math.round(capital * 0.30 / 10000) * 10000;   // 30% 단위 만원
  return { minAmt, maxAmt };
}

/** 만원 → "X만원" 또는 "X,XXX만원" 표기 */
function fmtManwon(won) {
  const man = Math.round(won / 10000);
  return man.toLocaleString('ko-KR') + '만원';
}

/**
 * 자본금 기준 기본값을 UI에 반영
 * @param {number} capital  적용할 자본금
 * @param {boolean} force   true면 STATE.config까지 덮어씀 (리셋 버튼)
 */
function applyDefaultPositionRange(capital, force) {
  const { minAmt, maxAmt } = calcDefaultRange(capital);

  // 슬라이더 max 동적 조정 (자본금의 100%까지 허용)
  const sliderMax = Math.max(capital, 1000000);
  document.getElementById('pos-min').max = sliderMax;
  document.getElementById('pos-max').max = sliderMax;

  if (force) {
    // 리셋: STATE + UI 모두 기본값으로
    STATE.config.posMinAmt  = minAmt;
    STATE.config.posMaxAmt  = maxAmt;
    STATE.config.posCapMult = 1.0;
    document.getElementById('pos-min').value    = minAmt;
    document.getElementById('pos-max').value    = maxAmt;
    document.getElementById('pos-min-num').value = Math.round(minAmt / 10000);
    document.getElementById('pos-max-num').value = Math.round(maxAmt / 10000);
    document.getElementById('pos-cap').value    = 1.0;
    document.getElementById('pos-cap-val').textContent = '1.0×';
  }

  // 미리보기 텍스트 항상 갱신
  const preEl = document.getElementById('pos-range-preview');
  if (preEl) {
    preEl.textContent =
      `자본금 ${fmtManwon(capital)} 기준 기본값 — 최소 ${fmtManwon(minAmt)} / 최대 ${fmtManwon(maxAmt)}`;
  }

  refreshPosRangeUI();
}

/** 슬라이더/숫자 입력 후 레이블·STATE·최종범위 동기화 */
function refreshPosRangeUI() {
  const minAmt = STATE.config.posMinAmt;
  const maxAmt = STATE.config.posMaxAmt;
  const cap    = STATE.config.posCapMult;
  const finalMax = Math.round(maxAmt * cap / 10000) * 10000;

  document.getElementById('pos-min-val').textContent  = fmtManwon(minAmt);
  document.getElementById('pos-max-val').textContent  = fmtManwon(maxAmt);
  document.getElementById('pos-cap-val').textContent  = cap.toFixed(1) + '×';
  document.getElementById('pos-range-final').textContent =
    `${fmtManwon(minAmt)} ~ ${fmtManwon(finalMax)}`;

  // 최솟값 > 최댓값 경고 표시
  const finalEl = document.getElementById('pos-range-final');
  if (minAmt > maxAmt) {
    finalEl.className = 'text-red-400 font-medium';
    finalEl.textContent = '⚠️ 최솟값이 최댓값보다 큽니다';
  } else {
    finalEl.className = 'text-white font-medium';
  }
}

/** 슬라이더(pos-min / pos-max) 변경 시 */
function onPosRangeChange() {
  const minSlider = parseInt(document.getElementById('pos-min').value);
  const maxSlider = parseInt(document.getElementById('pos-max').value);
  STATE.config.posMinAmt = minSlider;
  STATE.config.posMaxAmt = maxSlider;
  document.getElementById('pos-min-num').value = Math.round(minSlider / 10000);
  document.getElementById('pos-max-num').value = Math.round(maxSlider / 10000);
  refreshPosRangeUI();
}

/** 만원 숫자 입력(pos-min-num / pos-max-num) 변경 시 */
function onPosRangeNumChange(which) {
  const numId   = which === 'min' ? 'pos-min-num' : 'pos-max-num';
  const slId    = which === 'min' ? 'pos-min'     : 'pos-max';
  const man     = parseInt(document.getElementById(numId).value) || 1;
  const won     = man * 10000;
  const slMax   = parseInt(document.getElementById(slId).max);
  const clamped = Math.min(Math.max(won, 10000), slMax);
  document.getElementById(slId).value = clamped;
  if (which === 'min') STATE.config.posMinAmt = clamped;
  else                 STATE.config.posMaxAmt = clamped;
  refreshPosRangeUI();
}

/** 상한율 슬라이더 변경 시 */
function onPosCapChange() {
  const cap = parseFloat(document.getElementById('pos-cap').value);
  STATE.config.posCapMult = cap;
  refreshPosRangeUI();
}

/** 기본값 리셋 버튼 */
function resetPositionRange() {
  applyDefaultPositionRange(STATE.config.paperCapital, true);
  addLog('info', `↩️ 포지션 금액 기본값 복원 — ${fmtManwon(STATE.config.posMinAmt)} ~ ${fmtManwon(STATE.config.posMaxAmt)}`);
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
  const pc = Math.round(STATE.config.paperCapital / 1000000);

  document.getElementById('profit-target').value      = p;
  document.getElementById('profit-target-num').value  = p;
  document.getElementById('stop-loss').value          = sl;
  document.getElementById('stop-loss-num').value      = sl;
  document.getElementById('max-positions').value      = mp;
  document.getElementById('max-positions-num').value  = mp;
  document.getElementById('paper-capital').value      = pc;
  document.getElementById('paper-capital-num').value  = pc;
  document.getElementById('strategy-select').value    = localStorage.getItem('bot_strategy') || 'scalping';

  // 레이블 갱신
  document.getElementById('profit-val').textContent        = p + '%';
  document.getElementById('stoploss-val').textContent      = sl + '%';
  document.getElementById('maxpos-val').textContent        = mp + '개';
  document.getElementById('maxpos-display').textContent    = mp;
  document.getElementById('paper-capital-val').textContent = pc + '00만원';

  // 포지션 금액 범위 UI 복원
  // 저장된 값이 없으면(최초 실행) 자본금 기반 기본값으로 초기화
  const hasRange = saved && JSON.parse(saved).posMinAmt;
  if (!hasRange) {
    applyDefaultPositionRange(STATE.config.paperCapital, true);
  } else {
    // 저장된 값 UI에 반영
    const minAmt = STATE.config.posMinAmt;
    const maxAmt = STATE.config.posMaxAmt;
    const cap    = STATE.config.posCapMult;
    const slMax  = Math.max(STATE.config.paperCapital, 1000000);
    document.getElementById('pos-min').max   = slMax;
    document.getElementById('pos-max').max   = slMax;
    document.getElementById('pos-min').value = minAmt;
    document.getElementById('pos-max').value = maxAmt;
    document.getElementById('pos-min-num').value = Math.round(minAmt / 10000);
    document.getElementById('pos-max-num').value = Math.round(maxAmt / 10000);
    document.getElementById('pos-cap').value     = cap;
    applyDefaultPositionRange(STATE.config.paperCapital, false);
    refreshPosRangeUI();
  }
}

function saveConfig() {
  STATE.config.profitTarget      = parseFloat(document.getElementById('profit-target').value);
  STATE.config.stopLoss          = parseFloat(document.getElementById('stop-loss').value);
  STATE.config.maxPositions      = parseInt(document.getElementById('max-positions').value);
  STATE.config.posMinAmt         = parseInt(document.getElementById('pos-min').value);
  STATE.config.posMaxAmt         = parseInt(document.getElementById('pos-max').value);
  STATE.config.posCapMult        = parseFloat(document.getElementById('pos-cap').value);
  STATE.strategy                 = document.getElementById('strategy-select').value;
  localStorage.setItem('bot_config', JSON.stringify(STATE.config));
  localStorage.setItem('bot_strategy', STATE.strategy);
  // 카드 동기화
  document.getElementById('maxpos-display').textContent = STATE.config.maxPositions;
  renderPosSlots();
  const finalMax = Math.round(STATE.config.posMaxAmt * STATE.config.posCapMult / 10000) * 10000;
  addLog('info', `💾 설정 저장 — 최대포지션: ${STATE.config.maxPositions}개, 익절: ${STATE.config.profitTarget}%, 손절: ${STATE.config.stopLoss}%`);
  addLog('info', `   포지션 금액: ${fmtManwon(STATE.config.posMinAmt)} ~ ${fmtManwon(finalMax)} (상한율 ${STATE.config.posCapMult.toFixed(1)}×)`);
  renderStrategyConditions();
  updateStatsUI();
}

// ─── 적응형 진입 조건 파라미터 ────────────────────────────────
// 4단계: 0=공격(완화) 1=기본(표준) 2=방어(강화) 3=대기(매우강화)
// 승률 기준: ≥65% → 공격 | 40~64% → 기본 | 25~39% → 방어 | <25% → 대기
const ADAPTIVE_PARAMS = {
  scalping: [
    // 0: 공격 — 승률 ≥ 65%, 조건 완화
    {
      label: '🟢 공격', labelShort: '공격',
      rsiMin: 40, rsiMax: 60,         // RSI 40~60 (20%p)
      volMult: 1.3,                    // 거래량 1.3배
      pctMin: 0.2, pctMax: 2.5,       // 가격변동 0.2~2.5%
      buyPressure: 1.1,
      scoreBonus: 10,
      desc: '승률 ≥ 65% — 진입 조건 완화, 공격적 매수',
    },
    // 1: 기본 — 승률 40~64%
    {
      label: '🔵 기본', labelShort: '기본',
      rsiMin: 45, rsiMax: 55,         // RSI 45~55 (10%p) ← 핵심 수정
      volMult: 1.5,
      pctMin: 0.3, pctMax: 2.0,
      buyPressure: 1.2,
      scoreBonus: 0,
      desc: '승률 40~64% — 표준 진입 조건',
    },
    // 2: 방어 — 승률 25~39%
    {
      label: '🟡 방어', labelShort: '방어',
      rsiMin: 47, rsiMax: 53,         // RSI 47~53 (6%p)
      volMult: 2.0,
      pctMin: 0.4, pctMax: 1.5,
      buyPressure: 1.35,
      scoreBonus: -5,
      desc: '승률 25~39% — 조건 강화, 고확률 종목만 진입',
    },
    // 3: 대기 — 승률 < 25%
    {
      label: '🔴 대기', labelShort: '대기',
      rsiMin: 48, rsiMax: 52,         // RSI 48~52 (4%p) — 가장 엄격
      volMult: 2.5,
      pctMin: 0.5, pctMax: 1.0,
      buyPressure: 1.5,
      scoreBonus: -15,
      desc: '승률 < 25% — 진입 최소화, 손실 방어 최우선',
    },
  ],
  volume: [
    { label: '🟢 공격', labelShort: '공격', volMult: 1.5, pctMin: 0.3, pctMax: 6.0, rsiMax: 75, desc: '승률 ≥ 65%' },
    { label: '🔵 기본', labelShort: '기본', volMult: 2.0, pctMin: 0.5, pctMax: 5.0, rsiMax: 70, desc: '승률 40~64%' },
    { label: '🟡 방어', labelShort: '방어', volMult: 2.8, pctMin: 0.7, pctMax: 3.5, rsiMax: 65, desc: '승률 25~39%' },
    { label: '🔴 대기', labelShort: '대기', volMult: 3.5, pctMin: 1.0, pctMax: 2.5, rsiMax: 60, desc: '승률 < 25%' },
  ],
  momentum: [
    { label: '🟢 공격', labelShort: '공격', volMult: 1.0, pctMin: 0.5, adx: 20, desc: '승률 ≥ 65%' },
    { label: '🔵 기본', labelShort: '기본', volMult: 1.3, pctMin: 1.0, adx: 25, desc: '승률 40~64%' },
    { label: '🟡 방어', labelShort: '방어', volMult: 1.6, pctMin: 1.5, adx: 30, desc: '승률 25~39%' },
    { label: '🔴 대기', labelShort: '대기', volMult: 2.0, pctMin: 2.0, adx: 35, desc: '승률 < 25%' },
  ],
  mean_reversion: [
    { label: '🟢 공격', labelShort: '공격', rsiMax: 35, pctMin: -1.0, desc: '승률 ≥ 65%' },
    { label: '🔵 기본', labelShort: '기본', rsiMax: 30, pctMin: -1.5, desc: '승률 40~64%' },
    { label: '🟡 방어', labelShort: '방어', rsiMax: 25, pctMin: -2.0, desc: '승률 25~39%' },
    { label: '🔴 대기', labelShort: '대기', rsiMax: 20, pctMin: -3.0, desc: '승률 < 25%' },
  ],
};

/** 승률 → 적응 단계(0~3) 반환 */
function calcAdaptiveMode() {
  const results = STATE.recentResults;          // 최근 거래 결과 배열
  if (results.length < 3) return;              // 3회 미만이면 갱신 안 함
  const sample  = results.slice(-10);          // 최근 10회만
  const wins    = sample.filter(r => r.win).length;
  const winRate = (wins / sample.length) * 100;

  const prev = STATE.adaptiveMode;
  if      (winRate >= 65) STATE.adaptiveMode = 0;  // 공격
  else if (winRate >= 40) STATE.adaptiveMode = 1;  // 기본
  else if (winRate >= 25) STATE.adaptiveMode = 2;  // 방어
  else                    STATE.adaptiveMode = 3;  // 대기

  if (STATE.adaptiveMode !== prev) {
    const ap    = ADAPTIVE_PARAMS.scalping[STATE.adaptiveMode]; // 대표명
    const names = ['🟢 공격', '🔵 기본', '🟡 방어', '🔴 대기'];
    addLog('info',
      `📊 적응 모드 변경: ${names[prev]} → ${names[STATE.adaptiveMode]} ` +
      `(최근 ${sample.length}회 승률 ${winRate.toFixed(0)}%)`);
  }
  updateAdaptiveBadge();
  renderStrategyConditions();  // 진입 조건 패널도 즉시 갱신
}

/** 상단 배지 + 포지션 카드 배지 갱신 */
function updateAdaptiveBadge() {
  const mode  = STATE.adaptiveMode;
  const names = ['🟢 공격', '🔵 기본', '🟡 방어', '🔴 대기'];
  const colors= [
    'bg-green-900/60 text-green-300 border-green-700',
    'bg-blue-900/60  text-blue-300  border-blue-700',
    'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    'bg-red-900/60   text-red-300   border-red-700',
  ];
  const cls = `text-xs px-2 py-0.5 rounded border font-medium ${colors[mode]}`;
  ['adaptive-badge', 'adaptive-badge-2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = names[mode];
    el.className   = cls;
  });

  // 최근 승률 표시
  const sample  = STATE.recentResults.slice(-10);
  const wins    = sample.filter(r => r.win).length;
  const rateEl  = document.getElementById('adaptive-winrate');
  if (rateEl) {
    rateEl.textContent = sample.length > 0
      ? `최근 ${sample.length}회 승률 ${Math.round(wins/sample.length*100)}%`
      : '거래 없음';
  }
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

  // ── 적응형 파라미터로 진입 조건 표시 ──────────────────────
  const ap      = (ADAPTIVE_PARAMS[strat] || ADAPTIVE_PARAMS.scalping)[STATE.adaptiveMode];
  const condEl  = document.getElementById('strategy-conditions');
  const modeColors = ['text-green-400','text-blue-400','text-yellow-400','text-red-400'];
  const mc = modeColors[STATE.adaptiveMode];

  // 스캘핑은 RSI 표시, 거래량/모멘텀/평균회귀는 해당 핵심 조건 표시
  let condRows = '';
  if (strat === 'scalping') {
    condRows = `
      <div class="flex justify-between items-center bg-gray-800/50 rounded px-2 py-1.5">
        <span class="text-gray-400">RSI 범위</span>
        <span class="${mc} font-medium">${ap.rsiMin} ~ ${ap.rsiMax} <span class="text-gray-600 text-xs">(${ap.rsiMax-ap.rsiMin}%p)</span></span>
      </div>
      <div class="flex justify-between items-center bg-gray-800/50 rounded px-2 py-1.5">
        <span class="text-gray-400">가격 변동</span>
        <span class="${mc} font-medium">${ap.pctMin}% ~ ${ap.pctMax}%</span>
      </div>
      <div class="flex justify-between items-center bg-gray-800/50 rounded px-2 py-1.5">
        <span class="text-gray-400">거래량 배수</span>
        <span class="${mc} font-medium">${ap.volMult}× 이상</span>
      </div>
      <div class="flex justify-between items-center bg-gray-800/50 rounded px-2 py-1.5">
        <span class="text-gray-400">매수 압력</span>
        <span class="${mc} font-medium">${ap.buyPressure}× 이상</span>
      </div>`;
  } else {
    condRows = meta.conditions.map(c => `
      <div class="flex justify-between items-center bg-gray-800/50 rounded px-2 py-1.5">
        <span class="text-gray-400">${c.label}</span>
        <span class="${COLOR_MAP[c.color]||'text-gray-300'} font-medium">${c.value}</span>
      </div>`).join('');
    // 적응형 핵심 조건 추가 표시
    if (ap.volMult) condRows += `
      <div class="flex justify-between items-center bg-gray-800/60 rounded px-2 py-1.5 border-l-2 border-l-${modeColors[STATE.adaptiveMode].split('-')[1]}-500">
        <span class="text-gray-500 text-xs">📊 적응 거래량 기준</span>
        <span class="${mc} text-xs font-medium">${ap.volMult}× 이상</span>
      </div>`;
    if (ap.pctMin !== undefined) condRows += `
      <div class="flex justify-between items-center bg-gray-800/60 rounded px-2 py-1.5 border-l-2 border-l-${modeColors[STATE.adaptiveMode].split('-')[1]}-500">
        <span class="text-gray-500 text-xs">📊 적응 가격 기준</span>
        <span class="${mc} text-xs font-medium">${ap.pctMin > 0 ? '+' : ''}${ap.pctMin}% ~</span>
      </div>`;
  }

  condEl.innerHTML = condRows;

  const exitEl = document.getElementById('exit-conditions');
  const fee  = 0.245;
  const ep   = EXIT_PARAMS[strat] || EXIT_PARAMS.scalping;
  const trailTrigger = (profitTarget * ep.trailTriggerMult).toFixed(2);
  const trailCut     = (profitTarget * ep.trailTriggerMult + ep.trailDropPct).toFixed(2);
  exitEl.innerHTML = `
    <div class="flex justify-between items-start">
      <span class="text-gray-500">🔒 트레일 발동</span>
      <span class="text-orange-400 text-right">+${trailTrigger}% 도달 시<br><span class="text-gray-500 text-xs">(목표 ${profitTarget}% × ${ep.trailTriggerMult}×)</span></span>
    </div>
    <div class="flex justify-between items-start">
      <span class="text-gray-500">↘ 트레일 청산</span>
      <span class="text-yellow-400 text-right">고점에서 -${ep.trailDropPct}%p 하락<br><span class="text-gray-500 text-xs">예: 고점 +2%→ +${(2-ep.trailDropPct).toFixed(1)}% 이하 시 매도</span></span>
    </div>
    <div class="flex justify-between"><span class="text-gray-500">🚨 손절</span><span class="text-red-400">-${stopLoss}% (실제 -${(stopLoss + fee).toFixed(2)}%)</span></div>
    <div class="flex justify-between"><span class="text-gray-500">💸 슬리피지</span><span class="text-purple-400">-${ep.slippagePct}% (시장가 체결 미끄러짐)</span></div>
    <div class="flex justify-between"><span class="text-gray-500">⏰ 시간 청산</span><span class="text-yellow-400">${Math.round(ep.maxHoldSec/60)}분 초과</span></div>
    <div class="flex justify-between text-gray-600 pt-1 border-t border-gray-800 mt-1"><span>총 비용</span><span>수수료 ${fee}% + 슬리피지 ${ep.slippagePct}% = ${(fee+ep.slippagePct).toFixed(3)}%</span></div>
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
  const posMaxFinal = Math.round(STATE.config.posMaxAmt * STATE.config.posCapMult / 10000) * 10000;
  addLog('info', `   익절: +${STATE.config.profitTarget}% | 손절: -${STATE.config.stopLoss}% | 최대포지션: ${STATE.config.maxPositions}개`);
  addLog('info', `   포지션 금액: ${fmtManwon(STATE.config.posMinAmt)} ~ ${fmtManwon(posMaxFinal)} (상한율 ${STATE.config.posCapMult.toFixed(1)}×)`);

  // 장 시간 안내
  if (STATE.mode === 'live') {
    if (isMarketOpen()) {
      addLog('info', `   🟢 현재 정규장 시간 — 즉시 매매 활성`);
    } else {
      addLog('warn', `   ⚫ 현재 장 외 시간 — 신규 진입 차단, 보유 포지션 청산 체크만 진행`);
      addLog('warn', `   📅 다음 개장: ${getNextOpenStr()}`);
    }
  } else {
    addLog('info', `   📄 페이퍼 모드 — 장 시간 무관하게 시뮬레이션 실행`);
  }

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
  const marketOpen = isMarketOpen();
  const modeName   = STATE.mode === 'paper' ? '페이퍼' : '실전';

  // ─ 장 외 시간 안내 (처음 1회만 로그 출력 — 반복 스팸 방지)
  if (!marketOpen && STATE.mode === 'live') {
    if (!STATE._lastMarketClosedLog || Date.now() - STATE._lastMarketClosedLog > 5 * 60 * 1000) {
      addLog('warn', `⏸️  [실전] 장 외 시간 — 신규 진입 차단 (보유 포지션 청산 체크는 계속)`);
      STATE._lastMarketClosedLog = Date.now();
    }
  }

  const stratName = (STATE.strategy || 'scalping').toUpperCase();
  const timeStr   = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  addLog('scan', `🔍 [스캔 ${timeStr}] ${stratName} | ${modeName} | 장: ${marketOpen ? '🟢 정규장' : '⚫ 장 외'}`);

  // 1) 포지션 청산 체크 — 장 외에도 실행 (손절·트레일 보호)
  await checkPositionsForExit();

  // 2) 신규 진입 — 정규장 시간에만 허용 (페이퍼 모드는 항상 허용)
  const canEnter = STATE.mode === 'paper' || marketOpen;

  if (!canEnter) {
    addLog('scan', `   ⏸️  장 외 시간 — 신규 진입 차단 (${getNextOpenStr()} 개장 예정)`);
  } else if (STATE.positions.length < STATE.config.maxPositions) {
    await scanForEntries();
  } else {
    addLog('scan', `   📊 포지션 최대 (${STATE.positions.length}/${STATE.config.maxPositions}) — 진입 스킵`);
  }

  updateStatsUI();
  renderPositions();
}

// ─── 전략별 청산 파라미터 ────────────────────────────────────────
const EXIT_PARAMS = {
  // ⚡ 스캘핑: 빠른 익절·손절, 타이트한 트레일링
  scalping: {
    maxHoldSec:      900,   // 최대 보유 15분
    // 트레일링 스탑: 익절목표 돌파 후 고점에서 얼마 빠지면 매도
    trailTriggerMult: 1.0,  // 익절목표 × 1.0 = 목표 도달 즉시 트레일 발동
    trailDropPct:     0.4,  // 고점에서 0.4%p 하락 시 청산 (ex: 고점 2% → 1.6% 이하 시 매도)
    // 슬리피지: 시장가 매도 시 불리한 방향으로 미끄러짐
    slippagePct:      0.05, // 0.05% 슬리피지 (스캘핑 종목은 유동성 높아 낮음)
    // 시간 청산: maxHold 경과 + 소폭 수익 있으면 청산
    timeExitMinPnl:   0.1,
  },
  // 📊 거래량: 중간 트레일, 더 긴 보유
  volume: {
    maxHoldSec:      1800,
    trailTriggerMult: 1.0,
    trailDropPct:     0.6,
    slippagePct:      0.08,
    timeExitMinPnl:   0.1,
  },
  // 🚀 모멘텀: 느슨한 트레일, 추세 타기
  momentum: {
    maxHoldSec:      3600,
    trailTriggerMult: 1.2,  // 익절목표 120% 도달 시 트레일 발동 (더 달리게)
    trailDropPct:     1.0,
    slippagePct:      0.10,
    timeExitMinPnl:   0.0,  // 시간 청산 시 수익 조건 없음
  },
  // ↩️ 평균회귀: 빠른 수익 확정, 반등 후 즉시 청산
  mean_reversion: {
    maxHoldSec:      7200,
    trailTriggerMult: 0.8,  // 익절목표의 80% 도달 시 바로 트레일 발동
    trailDropPct:     0.3,
    slippagePct:      0.12,
    timeExitMinPnl:   0.0,
  },
};

// 포지션 청산 체크 (전략별 트레일링 스탑 + 슬리피지 적용)
async function checkPositionsForExit() {
  const ep = EXIT_PARAMS[STATE.strategy] || EXIT_PARAMS.scalping;

  for (let i = STATE.positions.length - 1; i >= 0; i--) {
    const pos = STATE.positions[i];
    const currentPrice = await fetchCurrentPrice(pos.ticker);
    if (!currentPrice) continue;

    pos.currentPrice = currentPrice;
    const pnlPct    = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    pos.pnlPct      = pnlPct;

    // 고점 갱신
    if (pnlPct > (pos.peakPnl || 0)) pos.peakPnl = pnlPct;

    const holdSec   = (Date.now() - pos.entryTime) / 1000;
    const target    = STATE.config.profitTarget;
    const stopLoss  = STATE.config.stopLoss;

    let exitReason = null;
    let exitType   = null; // 'profit' | 'loss' | 'trail' | 'time'

    // ── 1) 손절 ─────────────────────────────────────────────────
    if (pnlPct <= -stopLoss) {
      exitReason = `손절 ${pnlPct.toFixed(2)}%`;
      exitType   = 'loss';
    }

    // ── 2) 트레일링 스탑 ────────────────────────────────────────
    // 트레일 발동 조건: 익절목표 × trailTriggerMult 최초 도달
    else if (pnlPct >= target * ep.trailTriggerMult) {
      if (!pos.trailArmed) {
        pos.trailArmed = true;
        addLog('scan', `   🔒 트레일 발동: ${pos.name} 고점 ${pos.peakPnl.toFixed(2)}% (목표 ${target}% × ${ep.trailTriggerMult}× 돌파)`);
      }
      // 고점에서 trailDropPct 이상 하락 시 청산
      const dropFromPeak = pos.peakPnl - pnlPct;
      if (dropFromPeak >= ep.trailDropPct) {
        exitReason = `트레일 청산 | 고점 +${pos.peakPnl.toFixed(2)}% → 현재 +${pnlPct.toFixed(2)}% (${dropFromPeak.toFixed(2)}%p 하락)`;
        exitType   = 'trail';
      }
    }

    // ── 3) 단순 익절 (트레일 미발동 상태에서 목표 도달) ──────────
    // 트레일 발동 전이고 목표 도달: 트레일 준비 (즉시 청산 안 함)
    // → 위 2번 조건에서 trailArmed가 설정됨

    // ── 4) 시간 청산 ────────────────────────────────────────────
    else if (holdSec >= ep.maxHoldSec) {
      if (pnlPct > ep.timeExitMinPnl) {
        exitReason = `시간청산 (${Math.round(holdSec/60)}분) +${pnlPct.toFixed(2)}%`;
        exitType   = 'time';
      } else if (pnlPct <= 0) {
        // 손익 없거나 손실 상태로 최대 시간 초과 → 손실 최소화 청산
        exitReason = `시간초과 청산 (${Math.round(holdSec/60)}분) ${pnlPct.toFixed(2)}%`;
        exitType   = 'time';
      }
    }

    if (exitReason) {
      // 슬리피지 적용: 시장가 매도 시 불리하게 체결
      const slippage  = ep.slippagePct;
      const netPnlPct = pnlPct - 0.245 - slippage; // 수수료 + 슬리피지 차감
      await executeExit(pos, exitReason, netPnlPct, exitType, slippage);
      STATE.positions.splice(i, 1);
    }
  }
}

// 매도 실행 (슬리피지 반영)
async function executeExit(pos, reason, netPnlPct, exitType, slippagePct) {
  const slip = slippagePct || 0.05;
  // 실제 체결가 = 현재가에서 슬리피지만큼 불리하게 (매도 → 더 낮게)
  const actualExitPrice = Math.round(pos.currentPrice * (1 - slip / 100));
  const investAmt  = pos.entryPrice * pos.qty;
  const profitAmt  = Math.round(investAmt * netPnlPct / 100);
  const isWin      = netPnlPct > 0;

  if (STATE.mode === 'live') {
    try {
      const token = await getKisToken();
      const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
      const [cano, acntPrdtCd] = KEYS.accountNo.split('-');
      const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/order-cash`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
          appkey: KEYS.appKey, appsecret: KEYS.appSecret,
          tr_id: 'TTTC0801U', custtype: 'P',
        },
        body: JSON.stringify({
          CANO: cano, ACNT_PRDT_CD: acntPrdtCd,
          PDNO: pos.ticker, ORD_DVSN: '01', ORD_QTY: String(pos.qty), ORD_UNPR: '0',
        }),
      });
      const data = await res.json();
      if (data.rt_cd !== '0') throw new Error(data.msg1 || JSON.stringify(data));
    } catch(e) {
      addLog('error', `❌ 매도 실패: ${pos.ticker} — ${e.message}`);
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

  const icon  = isWin ? '✅' : '🚨';
  const color = isWin ? 'profit' : 'loss';
  const typeLabel = { profit: '익절', loss: '손절', trail: '트레일', time: '시간청산' }[exitType] || '청산';
  addLog(color, `${icon} [${typeLabel}] ${pos.name || pos.ticker} — ${reason}`);
  addLog(color, `   진입 ${fmtPrice(pos.entryPrice)} → 현재가 ${fmtPrice(pos.currentPrice)} → 체결 ${fmtPrice(actualExitPrice)} (슬리피지 -${slip}%)`);
  addLog(color, `   고점 +${(pos.peakPnl||0).toFixed(2)}% | 순손익 ${profitAmt > 0 ? '+' : ''}${fmtPrice(profitAmt)}원 (수수료+슬리피지 후 ${netPnlPct > 0 ? '+' : ''}${netPnlPct.toFixed(2)}%)`);

  // 거래 기록
  await recordTrade({
    ticker:     pos.ticker,
    name:       pos.name || pos.ticker,
    side:       'sell',
    entryPrice: pos.entryPrice,
    exitPrice:  actualExitPrice,
    qty:        pos.qty,
    pnlPct:     netPnlPct,
    profitAmt,
    peakPnl:    pos.peakPnl || 0,
    slippage:   slip,
    exitType,
    reason,
    timestamp:  new Date().toISOString(),
    mode:       STATE.mode,
  });
  await loadTradeHistory();

  // ── 거래 결과 누적 → 적응 모드 갱신 ──────────────────────
  STATE.recentResults.push({ win: isWin, pnlPct: netPnlPct });
  if (STATE.recentResults.length > 30) STATE.recentResults.shift(); // 최대 30회 보관
  calcAdaptiveMode(); // 10회 단위 평가
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

  // 네이버 프록시로 거래량 순위 실시간 조회 (API 키 불필요)
  try {
    const res = await axios.get('/api/naver/volume-rank?market=KOSPI&top=30', { timeout: 10000 });
    const stocks = res.data?.stocks || [];
    if (stocks.length > 0) {
      const ap = (ADAPTIVE_PARAMS[strategy] || ADAPTIVE_PARAMS.scalping)[STATE.adaptiveMode];
      const filtered = stocks.filter(item => {
        const pct = item.changeRate;
        if (strategy === 'scalping')       return pct > ap.pctMin && pct < ap.pctMax;
        if (strategy === 'volume')         return pct > 0;
        if (strategy === 'momentum')       return pct > ap.pctMin;
        if (strategy === 'mean_reversion') return pct < ap.pctMin;
        return true;
      });
      const result = filtered.slice(0, 5).map(item => ({
        ticker:    item.code,
        name:      item.name,
        price:     item.price,
        pctChange: item.changeRate,
        volume:    0,
        score:     Math.random() * 30 + 60 + ap.scoreBonus,
      }));
      if (result.length > 0) return result;
    }
  } catch(e) {
    addLog('warn', '⚠️ 거래량 순위 조회 실패 — 시뮬레이션 사용');
  }

  // API 없거나 실패 시 시뮬레이션 종목
  return generateSimCandidates(strategy);
}

function generateSimCandidates(strategy) {
  const STOCKS = [
    { ticker: '005930', name: '삼성전자',        basePrice: 78000 },
    { ticker: '000660', name: 'SK하이닉스',      basePrice: 195000 },
    { ticker: '035420', name: 'NAVER',           basePrice: 235000 },
    { ticker: '005380', name: '현대차',          basePrice: 265000 },
    { ticker: '051910', name: 'LG화학',          basePrice: 380000 },
    { ticker: '006400', name: '삼성SDI',         basePrice: 370000 },
    { ticker: '035720', name: '카카오',          basePrice: 48000 },
    { ticker: '068270', name: '셀트리온',        basePrice: 195000 },
    { ticker: '207940', name: '삼성바이오로직스', basePrice: 980000 },
    { ticker: '003670', name: '포스코홀딩스',    basePrice: 375000 },
  ];

  // 현재 적응 단계 파라미터 가져오기
  const ap = (ADAPTIVE_PARAMS[strategy] || ADAPTIVE_PARAMS.scalping)[STATE.adaptiveMode];

  const results = [];
  const shuffled = [...STOCKS].sort(() => Math.random() - 0.5);

  for (const s of shuffled.slice(0, 8)) {
    const pctChange   = (Math.random() - 0.3) * 4;
    const volMult     = 1 + Math.random() * 3;
    const rsi         = 30 + Math.random() * 50;
    const buyPressure = 0.8 + Math.random() * 0.8;

    let pass = false;
    if (strategy === 'scalping') {
      // 적응형 RSI/거래량/가격변동/매수압력 조건 적용
      pass = pctChange > ap.pctMin && pctChange < ap.pctMax
          && rsi > ap.rsiMin && rsi < ap.rsiMax
          && volMult >= ap.volMult
          && buyPressure >= ap.buyPressure;
    } else if (strategy === 'volume') {
      pass = volMult >= ap.volMult && pctChange > ap.pctMin && rsi < (ap.rsiMax || 70);
    } else if (strategy === 'momentum') {
      pass = pctChange > ap.pctMin && volMult >= ap.volMult;
    } else if (strategy === 'mean_reversion') {
      pass = pctChange < ap.pctMin && rsi < (ap.rsiMax || 30);
    }

    if (pass) {
      const price = s.basePrice * (1 + pctChange / 100);
      // 적응 단계에 따른 score 보정
      const baseScore = Math.round(50 + Math.random() * 40);
      results.push({
        ticker:      s.ticker,
        name:        s.name,
        price:       Math.round(price),
        pctChange:   parseFloat(pctChange.toFixed(2)),
        volume:      Math.round(1000000 * volMult),
        rsi:         parseFloat(rsi.toFixed(1)),
        buyPressure: parseFloat(buyPressure.toFixed(2)),
        score:       Math.min(100, Math.max(0, baseScore + (ap.scoreBonus || 0))),
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

  // ── 포지션 금액 범위 로직 ──────────────────────────────
  // 실제 최대 = 사용자 설정 최댓값 × 상한율
  const posMin    = STATE.config.posMinAmt  || 50000;
  const posMaxBase= STATE.config.posMaxAmt  || 150000;
  const posCapMult= STATE.config.posCapMult || 1.0;
  const posMaxFinal = Math.round(posMaxBase * posCapMult / 10000) * 10000;

  // 가용 현금이 최솟값보다 적으면 진입 불가
  if (available < posMin) {
    addLog('warn', `⚠️ 가용 현금(${fmtPrice(available)}원)이 포지션 최솟값(${fmtManwon(posMin)})보다 적음`);
    return;
  }

  // 투자금 = min ~ max 범위 내 랜덤 (가용 현금 초과 불가)
  // 조건에 따른 score 비례: score 높을수록 max에 가깝게
  const score     = (candidate.score || 70) / 100;           // 0~1
  const rawAmt    = posMin + Math.round((posMaxFinal - posMin) * score);
  const investAmt = Math.min(rawAmt, available, posMaxFinal);

  if (investAmt < 10000) return;

  const price = candidate.price || 1;
  const qty   = Math.floor(investAmt / price);
  if (qty < 1) return;

  if (STATE.mode === 'live') {
    try {
      const token = await getKisToken();
      const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
      const [cano, acntPrdtCd] = KEYS.accountNo.split('-');
      const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/order-cash`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
          appkey: KEYS.appKey, appsecret: KEYS.appSecret,
          tr_id: 'TTTC0802U', custtype: 'P',
        },
        body: JSON.stringify({
          CANO: cano, ACNT_PRDT_CD: acntPrdtCd,
          PDNO: candidate.ticker, ORD_DVSN: '01', ORD_QTY: String(qty), ORD_UNPR: '0',
        }),
      });
      const data = await res.json();
      if (data.rt_cd !== '0') throw new Error(data.msg1 || JSON.stringify(data));
    } catch(e) {
      addLog('error', `❌ 매수 실패: ${candidate.ticker} — ${e.message}`);
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
    peakPnl:      0,      // 트레일링 스탑용 고점 수익률 추적
    trailArmed:   false,  // 익절 목표 최초 돌파 여부
    score:        candidate.score,
  };
  STATE.positions.push(pos);

  addLog('buy', `💰 매수: ${pos.name} (${pos.ticker})`);
  addLog('buy', `   진입가 ${fmtPrice(pos.entryPrice)}원 | ${qty}주 | 투자 ${fmtPrice(qty * price)}원 (범위: ${fmtManwon(posMin)}~${fmtManwon(posMaxFinal)})`);
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
      // 고점 갱신 (트레일링 스탑용)
      if (pos.pnlPct > (pos.peakPnl || 0)) pos.peakPnl = pos.pnlPct;
    }
  }
  renderPositions();
  updateStatsUI(); // 포지션 가격 변동 → 총자산 카드 즉시 반영
}

async function fetchCurrentPrice(ticker) {
  if (STATE.mode === 'live' && KEYS.appKey) {
    try {
      // 네이버 프록시로 현재가 조회
      const res = await axios.get(`/api/naver/price/${ticker}`, { timeout: 4000 });
      return res.data?.price || null;
    } catch { return null; }
  }
  // 페이퍼: 시뮬레이션 가격 (소폭 랜덤 변동)
  const pos = STATE.positions.find(p => p.ticker === ticker);
  if (!pos) return null;
  const drift = (Math.random() - 0.48) * pos.entryPrice * 0.003;
  return Math.round(pos.currentPrice + drift);
}

async function getLiveBalance() {
  if (!KEYS.appKey || !KEYS.accountNo) return 0;
  try {
    const token = await getKisToken();
    const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
    const [cano, acntPrdtCd] = KEYS.accountNo.split('-');
    const url = `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${cano}&ACNT_PRDT_CD=${acntPrdtCd}&AFHR_FLPR_YN=N&OFL_YN=&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=00&CTX_AREA_FK100=&CTX_AREA_NK100=`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: KEYS.appKey, appsecret: KEYS.appSecret,
        tr_id: 'TTTC8434R', custtype: 'P',
      },
    });
    const data = await res.json();
    return parseFloat(data?.output2?.[0]?.dnca_tot_amt || 0);
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
    const ep        = EXIT_PARAMS[STATE.strategy] || EXIT_PARAMS.scalping;
    const netPnl    = pos.pnlPct - 0.245;
    const isProfit  = netPnl >= 0;
    const holdMin   = Math.floor((Date.now() - pos.entryTime) / 60000);
    const holdSec   = Math.floor(((Date.now() - pos.entryTime) % 60000) / 1000);
    const pnlAmt    = Math.round(pos.entryPrice * pos.qty * netPnl / 100);
    const bar       = Math.min(Math.abs(pos.pnlPct) / STATE.config.profitTarget * 100, 100);
    const peakPnl   = pos.peakPnl || 0;
    const dropFromPeak = peakPnl - pos.pnlPct;

    // 트레일 상태 배지
    const trailBadge = pos.trailArmed
      ? `<span class="ml-1 px-1 py-0.5 rounded text-xs bg-orange-900/60 text-orange-300">🔒트레일</span>`
      : (pos.pnlPct >= STATE.config.profitTarget * ep.trailTriggerMult
          ? `<span class="ml-1 px-1 py-0.5 rounded text-xs bg-yellow-900/60 text-yellow-300">목표도달</span>`
          : '');

    // 고점 대비 낙폭 경고
    const dropWarn = pos.trailArmed && dropFromPeak > ep.trailDropPct * 0.5
      ? `<span class="text-orange-400">↘ 고점-${dropFromPeak.toFixed(2)}%p (청산기준 -${ep.trailDropPct}%p)</span>`
      : `<span>익절까지 ${Math.max(0, (STATE.config.profitTarget - pos.pnlPct)).toFixed(2)}%</span>`;

    return `
    <div class="position-card ${isProfit ? 'profit' : 'loss'}">
      <div class="flex justify-between items-start mb-1">
        <div class="flex items-center flex-wrap gap-1">
          <span class="font-medium text-sm text-white">${pos.name}</span>
          <span class="text-gray-500 text-xs">${pos.ticker}</span>
          ${trailBadge}
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
      ${peakPnl > 0 ? `<div class="text-xs text-gray-600 mt-0.5">고점 +${peakPnl.toFixed(2)}% | 슬리피지 -${ep.slippagePct}%</div>` : ''}
      <div class="mt-1.5 h-1 bg-gray-800 rounded">
        <div class="h-1 rounded ${pos.trailArmed ? 'bg-orange-500' : (isProfit ? 'bg-green-500' : 'bg-red-500')}" style="width:${bar}%"></div>
      </div>
      <div class="text-xs text-gray-600 mt-0.5">${dropWarn}</div>
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

  // 네이버 프록시로 실시간 조회 (API 키 불필요)
  try {
    const res = await axios.get(`/api/naver/price/${ticker}`, { timeout: 5000 });
    const d = res.data;
    if (d?.ok) {
      const pct = d.changeRate;
      el.innerHTML = `
        <div class="scanner-card col-span-2">
          <div class="flex justify-between">
            <span class="font-medium text-white text-sm">${d.name || ticker}</span>
            <span class="text-xs text-gray-500">${ticker} · ${d.market || ''}</span>
          </div>
          <div class="text-lg font-bold text-white mt-1">${fmtPrice(d.price)}원</div>
          <div class="${pct >= 0 ? 'text-green-400' : 'text-red-400'} text-sm">${pct >= 0 ? '+' : ''}${pct}%</div>
          <div class="text-xs text-gray-500 mt-1">전일 대비 ${d.change >= 0 ? '+' : ''}${fmtPrice(d.change)}원</div>
        </div>`;
      addLog('info', `🔍 ${d.name || ticker}: ${fmtPrice(d.price)}원 (${pct >= 0 ? '+' : ''}${pct}%) [네이버 실시간]`);
      return;
    }
  } catch(e) {
    addLog('warn', '⚠️ 종목 조회 실패 — ' + e.message);
  }
  el.innerHTML = '<div class="col-span-full text-gray-600 text-sm text-center py-4">조회 실패 — 종목코드를 확인하세요</div>';
}

async function loadVolumeRank() {
  const el = document.getElementById('scanner-result');
  el.innerHTML = '<div class="col-span-full text-gray-500 text-sm text-center py-4">🔄 거래량 상위 조회 중...</div>';

  // 네이버 프록시로 거래량 순위 조회 (API 키 불필요)
  try {
    const res = await axios.get('/api/naver/volume-rank?market=KOSPI&top=20', { timeout: 10000 });
    const items = (res.data?.stocks || []).slice(0, 12);
    if (items.length > 0) {
      el.innerHTML = items.map(item => {
        const pct = item.changeRate;
        return `
        <div class="scanner-card" onclick="document.getElementById('ticker-input').value='${item.code}'; lookupStock()">
          <div class="font-medium text-white text-xs truncate">${item.name}</div>
          <div class="text-sm font-bold text-white mt-0.5">${fmtPrice(item.price)}원</div>
          <div class="${pct >= 0 ? 'text-green-400' : 'text-red-400'} text-xs">${pct >= 0 ? '+' : ''}${pct}%</div>
          <div class="text-xs text-gray-600 mt-0.5">거래량 상위 ${item.rank}위</div>
        </div>`;
      }).join('');
      addLog('info', `📊 거래량 상위 ${items.length}개 로드 완료 [네이버 실시간]`);
      return;
    }
  } catch(e) {
    addLog('warn', '⚠️ 거래량 순위 조회 실패 — ' + e.message);
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

/**
 * 현재 정규 거래 가능 여부 반환 (09:00~15:30, 평일만)
 * runScan() / scanForEntries() 에서 진입 차단에 사용
 */
function isMarketOpen() {
  const now = new Date();
  const h   = now.getHours(), m = now.getMinutes();
  const day = now.getDay(); // 0=일, 6=토
  if (day === 0 || day === 6) return false;
  // 09:00:00 이상, 15:30:00 이하
  const minTotal = h * 60 + m;
  return minTotal >= 9 * 60 && minTotal <= 15 * 60 + 30;
}

function updateMarketStatus() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const day = now.getDay(); // 0=일, 6=토
  const dot   = document.getElementById('market-dot');
  const label = document.getElementById('market-label');

  const isWeekday = day >= 1 && day <= 5;
  const inSession = isMarketOpen();
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
