// ============================================================
// StockBot - 한국/미국 주식 자동매매 웹앱
// KIS (한국투자증권) API 연동 — 국내 + 미국주식 지원
// ============================================================

// ─── 전역 상태 ───────────────────────────────────────────────
const STATE = {
  running: false,
  mode: 'paper',           // 'paper' | 'live'
  market: 'KR',           // 'KR'=국내 | 'US'=미국 | 'BOTH'=국내+미국 동시
  strategy: 'scalping',
  positions: [],           // [{ticker, name, entryPrice, qty, entryTime, currentPrice, pnlPct, market}]
  stats: { totalTrades: 0, winTrades: 0, totalProfit: 0, dailyProfit: 0 },
  config: {
    maxPositions: 3,
    positionSizeRatio: 0.30,
    profitTarget: 1.5,
    stopLoss: 1.0,
    scanInterval: 30,
    paperCapital: 5000000,
    posMinAmt: 50000,
    posMaxAmt: 150000,
    posCapMult: 1.0,
    // 미국주식 전용
    usRatio: 0.5,          // BOTH 모드에서 미국주식 자본 비중 (0.0~1.0)
  },
  paperBalance: 5000000,   // 페이퍼 가용 현금 (원화)
  paperBalanceUsd: 0,      // 페이퍼 달러 잔고 (BOTH/US 모드)
  scanTimer: null,
  nextScanIn: 0,
  countdownTimer: null,
  profitHistory: [],
  candidates: [],
  adaptiveMode: 1,
  recentResults: [],
  // ── 실전 잔고 캐시 ─────────────────────────────────────
  liveBalance: 0,
  liveBalanceTs: 0,
  liveBalanceFetching: false,
  // ── 미국주식 잔고 캐시 ─────────────────────────────────
  liveBalanceUsd: 0,       // 달러 현금 잔고
  liveBalanceUsdTs: 0,
  liveBalanceUsdFetching: false,
  // ── 환율 캐시 ──────────────────────────────────────────
  usdKrw: 1380,            // 원/달러 환율 (기본값)
  usdKrwTs: 0,             // 환율 마지막 조회
  // ── 장 마감 청산 플래그 ────────────────────────────────
  krCloseAlertSent: false,   // 국내 장마감 30분 전 청산 알림 발송 여부
  usCloseAlertSent: false,   // 미국 장마감 30분 전 청산 알림 발송 여부
  // ── 내부 플래그 ────────────────────────────────────────
  _lastMarketClosedLog: 0,
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
 * KIS 토큰 발급 — 서버 프록시(/api/kis/token) 경유
 * ∙ 로컬 샌드박스: 해외 서버 → KIS 연결 차단 → serverBlocked:true 반환
 * ∙ Cloudflare Pages 배포 후: 엣지 서버 → KIS 정상 연결 기대
 */
async function kisGetTokenViaProxy(appKey, appSecret) {
  const cached = sessionStorage.getItem('kis_token_cached');
  const exp    = parseInt(sessionStorage.getItem('kis_token_exp') || '0');
  if (cached && Date.now() < exp) return cached;

  const res = await fetch('/api/kis/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = await res.json();
  if (!res.ok || data.serverBlocked) {
    // 서버 프록시 차단 → null 반환 (호출자에서 처리)
    throw Object.assign(new Error(data.error || '서버 프록시 차단'), { serverBlocked: true });
  }
  // 프록시 성공 시 클라이언트 캐시에도 저장 (상징적 — 실제 토큰은 서버 KV에 캐시됨)
  sessionStorage.setItem('kis_token_cached', 'proxy_ok');
  sessionStorage.setItem('kis_token_exp', String(Date.now() + 82800 * 1000));
  return 'proxy_ok';  // 토큰 자체는 서버에서 관리
}

/** KIS 토큰 반환 — 서버 프록시 경유 (캐시 포함) */
async function getKisToken() {
  return await kisGetTokenViaProxy(KEYS.appKey, KEYS.appSecret);
}

async function testApiConnection() {
  showApiResult('🔄 서버 프록시로 KIS 연결 테스트 중...', 'info');
  const k = document.getElementById('input-app-key').value.trim();
  const s = document.getElementById('input-app-secret').value.trim();
  if (!k || k === '●●●●●●●●' || !s || s === '●●●●●●●●') {
    showApiResult('⚠️ APP KEY와 APP SECRET를 먼저 입력하세요', 'warn'); return;
  }

  // ── 1단계: 네이버 프록시 테스트 (항상 가능) ──
  try {
    const nr = await axios.get('/api/naver/price/005930', { timeout: 5000 });
    if (nr.data?.ok) {
      addLog('info', `📊 네이버 시세 연동 ✅ — 삼성전자 ${(nr.data.price||0).toLocaleString()}원`);
    }
  } catch(e) {
    addLog('warn', '⚠️ 네이버 시세 조회 실패: ' + (e.message||''));
  }

  // ── 2단계: 서버 프록시 → KIS 연결 테스트 ──
  try {
    const res = await fetch('/api/kis/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: k, appSecret: s }),
    });
    const data = await res.json();

    if (data.ok) {
      // ✅ 토큰 발급 성공 — KIS 연결 + 인증 모두 OK
      sessionStorage.setItem('kis_token_cached', 'proxy_ok');
      sessionStorage.setItem('kis_token_exp', String(Date.now() + 82800 * 1000));
      showApiResult('✅ KIS 연결 성공! 실전 모드로 거래 가능합니다', 'ok');
      addLog('info', '✅ KIS 연결 성공 — 서버 프록시 모드 (실전 모드 사용 가능)');
    } else if (data.kisReachable) {
      // ⚠️ KIS 서버에는 연결됐으나 키 인증 실패 (잘못된 키)
      showApiResult('⚠️ KIS 서버 연결 OK — 키 인증 실패. APP KEY/SECRET을 확인하세요', 'warn');
      addLog('warn', '⚠️ KIS 서버 연결 성공, 하지만 인증 실패');
      addLog('warn', `   오류: ${data.error || ''}`);
      addLog('info', '💡 KIS Developers(apiportal.koreainvestment.com)에서 APP KEY/SECRET을 확인하세요');
      addLog('info', '   네이버 시세 연동은 정상 — 키 수정 후 다시 테스트하세요');
    } else if (data.serverBlocked) {
      // ⛔ 서버→KIS 네트워크 연결 자체가 안 됨
      showApiResult('⚠️ 서버→KIS 네트워크 차단 — 아래 안내를 확인하세요', 'warn');
      addLog('warn', '⚠️ 서버→KIS 네트워크 연결 실패');
      addLog('info', '📄 페이퍼 모드: 지금 바로 사용 가능합니다');
      addLog('info', '🌐 실전 모드: 재배포 후 재시도 권장');
      showLiveModeBanner();
    } else {
      showApiResult('❌ KIS 오류: ' + (data.error || '알 수 없는 오류').slice(0, 80), 'error');
      addLog('error', '❌ KIS 오류: ' + (data.error || ''));
    }
  } catch(e) {
    const msg = e.message || String(e);
    showApiResult('❌ 서버 오류: ' + msg.slice(0, 60), 'error');
    addLog('error', '❌ 연결 테스트 실패: ' + msg);
  }
}

/** 실전 모드 제약 안내 배너를 모달에 표시 */
function showLiveModeBanner() {
  let banner = document.getElementById('live-mode-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'live-mode-banner';
    banner.className = 'bg-yellow-950/60 border border-yellow-700 rounded p-3 text-xs text-yellow-300 space-y-1.5';
    const modal = document.querySelector('#api-modal .space-y-4');
    if (modal) modal.appendChild(banner);
  }
  banner.innerHTML = `
    <p class="font-semibold text-yellow-200"><i class="fas fa-exclamation-triangle mr-1"></i>실전 모드 이용 안내</p>
    <p>• <strong>KIS API는 서버 전용</strong> — 브라우저 직접 호출이 불가합니다 (CORS 정책)</p>
    <p>• <strong>현재 환경</strong>: 로컬 샌드박스 서버 → KIS 연결이 차단되어 있습니다</p>
    <p class="pt-1 border-t border-yellow-800">✅ <strong>페이퍼 모드</strong>: 지금 바로 사용 가능 (시뮬레이션)</p>
    <p>🌐 <strong>실전 모드</strong>: Cloudflare Pages 배포 후 서버 프록시로 이용 가능</p>
  `;
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
  if (mode === 'live') {
    if (!KEYS.appKey) {
      addLog('warn', '⚠️ 실전 모드: API 키를 먼저 설정하세요');
      openApiSettings();
    } else {
      addLog('warn', '🔴 실전 모드 활성화');
      addLog('info', '   ∙ 시세 조회: 네이버 금융 프록시 (정상)');
      addLog('info', '   ∙ 주문 실행: 서버 프록시(/api/kis/order) 경유');
      addLog('info', '   ⚠️ 로컬 환경에서는 주문이 차단될 수 있습니다 — 연결 테스트 먼저 권장');
      // ── 실전 전환 즉시 잔고 조회 시작 ─────────────────
      STATE.liveBalanceTs = 0;
      const cashEl = document.getElementById('stat-cash');
      if (cashEl) cashEl.textContent = '조회 중…';
      if (KEYS.accountNo && !STATE.liveBalanceFetching) {
        STATE.liveBalanceFetching = true;
        getLiveBalance().then(bal => {
          STATE.liveBalance    = bal;
          STATE.liveBalanceTs  = Date.now();
          STATE.liveBalanceFetching = false;
          if (bal > 0) addLog('info', `💰 실전 잔고 확인: ${fmtPrice(bal)}원`);
          updateStatsUI();
        }).catch(() => { STATE.liveBalanceFetching = false; });
      }
      // 미국 모드면 달러 잔고도 조회
      if (STATE.market === 'US' || STATE.market === 'BOTH') {
        triggerUsdBalanceFetch();
      }
    }
  } else {
    STATE.liveBalance = 0;
    STATE.liveBalanceTs = 0;
    STATE.liveBalanceUsd = 0;
    STATE.liveBalanceUsdTs = 0;
  }
  renderStrategyConditions();
}

// ─── 시장 선택 (국내 / 미국 / 국내+미국) ─────────────────────
function setMarket(market) {
  STATE.market = market; // 'KR' | 'US' | 'BOTH'
  localStorage.setItem('bot_market', market);

  // 버튼 활성 상태 업데이트
  ['KR', 'US', 'BOTH'].forEach(m => {
    const el = document.getElementById('market-' + m);
    if (el) el.classList.toggle('active-market', m === market);
  });

  // 시장별 안내 로그
  if (market === 'KR') {
    addLog('info', '🇰🇷 국내주식 모드 — 코스피/코스닥 정규장 (09:00~15:30)');
    // 미국 잔고 캐시 초기화
    STATE.liveBalanceUsd = 0;
    STATE.liveBalanceUsdTs = 0;
  } else if (market === 'US') {
    addLog('info', '🇺🇸 미국주식 모드 — 야간 정규장 (23:30~06:00 KST)');
    addLog('info', '   ∙ 지정가 주문만 지원 (KIS API 제약)');
    addLog('info', '   ∙ 달러 지정가로 주문, 잔고는 달러 표시');
    // 미국 잔고 즉시 조회
    if (STATE.mode === 'live') triggerUsdBalanceFetch();
  } else if (market === 'BOTH') {
    addLog('info', '🌏 국내+미국 동시 모드');
    addLog('info', `   ∙ 자본 배분: 미국 ${Math.round(STATE.config.usRatio * 100)}% / 국내 ${Math.round((1-STATE.config.usRatio)*100)}%`);
    if (STATE.mode === 'live') triggerUsdBalanceFetch();
  }

  // 환율 패널 표시 여부
  const fxPanel = document.getElementById('fx-panel');
  if (fxPanel) fxPanel.classList.toggle('hidden', market === 'KR');

  // 환율 최신화
  if (market !== 'KR') fetchUsdKrw();

  updateMarketStatus();
  updateStatsUI();
}

function triggerUsdBalanceFetch() {
  if (!KEYS.appKey || !KEYS.accountNo || STATE.liveBalanceUsdFetching) return;
  STATE.liveBalanceUsdFetching = true;
  getUsLiveBalance().then(usd => {
    STATE.liveBalanceUsd    = usd;
    STATE.liveBalanceUsdTs  = Date.now();
    STATE.liveBalanceUsdFetching = false;
    if (usd > 0) addLog('info', `💵 미국주식 달러 잔고: $${usd.toFixed(2)} (≈${fmtPrice(Math.round(usd * STATE.usdKrw))}원)`);
    updateStatsUI();
  }).catch(() => { STATE.liveBalanceUsdFetching = false; });
}

function updateSlider(id, labelId, suffix) {
  const val = parseFloat(document.getElementById(id).value);
  document.getElementById(labelId).textContent = val.toFixed(1) + suffix;
  // ─ 슬라이더 변경 즉시 STATE.config 반영 (저장 버튼 없이도 봇에 적용)
  if (id === 'profit-target') {
    STATE.config.profitTarget = val;
    document.getElementById('profit-target-num').value = val;
  } else if (id === 'stop-loss') {
    STATE.config.stopLoss = val;
    document.getElementById('stop-loss-num').value = val;
  } else if (id === 'max-positions') {
    STATE.config.maxPositions = parseInt(val);
    document.getElementById('max-positions-num').value = parseInt(val);
    document.getElementById('maxpos-display').textContent = parseInt(val);
    renderPosSlots();
  }
  autoSaveConfig();
  renderStrategyConditions();
}

function updateCapitalSlider() {
  const val = parseInt(document.getElementById('paper-capital').value);
  document.getElementById('paper-capital-val').textContent = val + '00만원';
  document.getElementById('paper-capital-num').value = val;
  STATE.config.paperCapital = val * 1000000;
  applyDefaultPositionRange(STATE.config.paperCapital, false);
  autoSaveConfig();
}

// 숫자 입력 → 슬라이더 동기화 + STATE 즉시 반영
function syncSliderFromNum(sliderId, numId, labelId, suffix) {
  const num = parseFloat(document.getElementById(numId).value);
  const slider = document.getElementById(sliderId);
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const clamped = Math.min(Math.max(num, min), max);
  slider.value = clamped;
  document.getElementById(labelId).textContent = clamped.toFixed(suffix === '개' ? 0 : 1) + suffix;
  // STATE.config 즉시 반영
  if (sliderId === 'profit-target') STATE.config.profitTarget = clamped;
  else if (sliderId === 'stop-loss')  STATE.config.stopLoss    = clamped;
  else if (sliderId === 'max-positions') {
    STATE.config.maxPositions = parseInt(clamped);
    document.getElementById('maxpos-display').textContent = parseInt(clamped);
    renderPosSlots();
  }
  autoSaveConfig();
}

function syncCapitalFromNum() {
  const val = parseInt(document.getElementById('paper-capital-num').value) || 1;
  document.getElementById('paper-capital').value = val;
  document.getElementById('paper-capital-val').textContent = val + '00만원';
  STATE.config.paperCapital = val * 1000000;
  applyDefaultPositionRange(STATE.config.paperCapital, false);
  autoSaveConfig();
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
  autoSaveConfig();
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
  autoSaveConfig();
}

/** 상한율 슬라이더 변경 시 */
function onPosCapChange() {
  const cap = parseFloat(document.getElementById('pos-cap').value);
  STATE.config.posCapMult = cap;
  refreshPosRangeUI();
  autoSaveConfig();
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
  // market 복원
  const savedMarket = localStorage.getItem('bot_market') || 'KR';
  STATE.market = savedMarket;
  ['KR','US','BOTH'].forEach(m => {
    const el = document.getElementById('market-' + m);
    if (el) el.classList.toggle('active-market', m === savedMarket);
  });
  // 환율 패널 표시 여부
  const fxPanel = document.getElementById('fx-panel');
  if (fxPanel) fxPanel.classList.toggle('hidden', savedMarket === 'KR');

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
  document.getElementById('profit-val').textContent        = parseFloat(p).toFixed(1) + '%';
  document.getElementById('stoploss-val').textContent      = parseFloat(sl).toFixed(1) + '%';
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

/** 슬라이더 변경 시 STATE → localStorage 자동저장 (로그 없이) */
function autoSaveConfig() {
  STATE.config.paperCapital = parseInt(document.getElementById('paper-capital').value) * 1000000 || STATE.config.paperCapital;
  localStorage.setItem('bot_config', JSON.stringify(STATE.config));
  localStorage.setItem('bot_strategy', document.getElementById('strategy-select')?.value || STATE.strategy);
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

  // US / BOTH 모드: 페이퍼 달러 잔고 초기화
  // 자본금의 usRatio 비율만큼 달러로 배분 (원화→달러 환산)
  if (STATE.mode === 'paper') {
    if (STATE.market === 'US') {
      STATE.paperBalanceUsd = STATE.config.paperCapital / STATE.usdKrw;
      STATE.paperBalance = 0; // US 모드는 원화 잔고 불필요
      addLog('info', `💵 페이퍼 달러 잔고 초기화: $${STATE.paperBalanceUsd.toFixed(2)} (환율 ${fmtPrice(STATE.usdKrw)}원/달러)`);
    } else if (STATE.market === 'BOTH') {
      const usdPart = STATE.config.paperCapital * STATE.config.usRatio;
      STATE.paperBalanceUsd = usdPart / STATE.usdKrw;
      STATE.paperBalance = STATE.config.paperCapital * (1 - STATE.config.usRatio);
      addLog('info', `🌏 페이퍼 자본 배분: 국내 ${fmtManwon(STATE.paperBalance)} / 미국 $${STATE.paperBalanceUsd.toFixed(2)}`);
    }
  }

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
  const mkt = STATE.market;
  const krOpen = isKrMarketOpen();
  const usOpen = isUsMarketOpen();
  const anyOpen = isMarketOpen();
  const modeName = STATE.mode === 'paper' ? '페이퍼' : '실전';
  const mktLabel = { KR: '🇰🇷국내', US: '🇺🇸미국', BOTH: '🌏국내+미국' }[mkt] || mkt;

  // ── 장 마감 전 30분: 자동 청산 경고 + 실행 ─────────────────
  if (STATE.mode !== 'paper') {
    // 국내 마감 30분 전 (KR or BOTH)
    if ((mkt === 'KR' || mkt === 'BOTH') && isKrMarketClosingSoon() && !STATE.krCloseAlertSent) {
      STATE.krCloseAlertSent = true;
      const krPos = STATE.positions.filter(p => p.market === 'KR' || !p.market);
      if (krPos.length > 0) {
        addLog('warn', `⏰ [국내] 장 마감 30분 전 (15:00) — 보유 ${krPos.length}개 포지션 자동 청산 시작`);
        for (const pos of [...krPos]) {
          await executeExit(pos, '장마감 전 청산', pos.pnlPct, 'close_eod', 0.05);
        }
        addLog('info', '✅ [국내] 장마감 전 청산 완료');
      }
    }
    // 국내 장 열리면 플래그 초기화
    if (krOpen) STATE.krCloseAlertSent = false;

    // 미국 마감 30분 전 (US or BOTH)
    if ((mkt === 'US' || mkt === 'BOTH') && isUsMarketClosingSoon() && !STATE.usCloseAlertSent) {
      STATE.usCloseAlertSent = true;
      const usPos = STATE.positions.filter(p => p.market === 'US');
      if (usPos.length > 0) {
        addLog('warn', `⏰ [미국] 장 마감 30분 전 (05:30 KST) — 보유 ${usPos.length}개 포지션 자동 청산 시작`);
        for (const pos of [...usPos]) {
          await executeExit(pos, '장마감 전 청산', pos.pnlPct, 'close_eod', 0.05);
        }
        addLog('info', '✅ [미국] 장마감 전 청산 완료');
      }
    }
    // 미국 장 열리면 플래그 초기화
    if (usOpen) STATE.usCloseAlertSent = false;
  }

  // ─ 장 외 시간 안내
  if (!anyOpen && STATE.mode === 'live') {
    if (!STATE._lastMarketClosedLog || Date.now() - STATE._lastMarketClosedLog > 5 * 60 * 1000) {
      addLog('warn', `⏸️  [실전] 장 외 시간 — 신규 진입 차단 (다음: ${getNextOpenStr()})`);
      STATE._lastMarketClosedLog = Date.now();
    }
  }

  const stratName = (STATE.strategy || 'scalping').toUpperCase();
  const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const mktSt = (mkt==='KR') ? (krOpen?'🟢정규장':'⚫마감')
              : (mkt==='US') ? (usOpen?'🔵야간장':'⚫마감')
              : `KR:${krOpen?'🟢':'⚫'} US:${usOpen?'🔵':'⚫'}`;
  addLog('scan', `🔍 [스캔 ${timeStr}] ${stratName} | ${modeName} | ${mktLabel} ${mktSt}`);

  // 1) 포지션 청산 체크 — 장 외에도 실행 (손절·트레일 보호)
  await checkPositionsForExit();

  // 2) 신규 진입 — 정규장 시간에만 허용 (페이퍼 모드는 항상)
  const canEnter = STATE.mode === 'paper' || anyOpen;
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
  const isUs = pos.market === 'US';
  // 슬리피지 적용 체결가
  const actualExitPrice = isUs
    ? Math.round(pos.currentPrice * (1 - slip / 100) * 100) / 100  // 달러 소수점 2자리
    : Math.round(pos.currentPrice * (1 - slip / 100));              // 원화 정수
  const investAmt  = pos.entryPrice * pos.qty;
  const profitAmt  = Math.round(investAmt * netPnlPct / 100);
  const isWin      = netPnlPct > 0;

  if (STATE.mode === 'live') {
    try {
      if (isUs) {
        // 미국주식 매도
        const excd = getUsExchangeCode(pos.ticker).replace('NAS','NASD').replace('NYS','NYSE');
        const res = await fetch('/api/kis/us/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appKey: KEYS.appKey, appSecret: KEYS.appSecret, accountNo: KEYS.accountNo,
            symbol: pos.ticker, excd,
            side: 'sell', qty: pos.qty,
            price: actualExitPrice.toFixed(2), // 달러 지정가
          }),
        });
        const data = await res.json();
        if (data.serverBlocked) { addLog('warn', `⚠️ 미국 매도 서버 차단: ${pos.ticker}`); return; }
        if (!data.ok) throw new Error(data.error || JSON.stringify(data));
      } else {
        // 국내주식 매도
        const res = await fetch('/api/kis/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appKey: KEYS.appKey, appSecret: KEYS.appSecret, accountNo: KEYS.accountNo,
            ticker: pos.ticker, side: 'sell', qty: pos.qty,
          }),
        });
        const data = await res.json();
        if (data.serverBlocked) { addLog('warn', `⚠️ 매도 서버 차단: ${pos.ticker}`); return; }
        if (!data.ok) throw new Error(data.error || JSON.stringify(data));
      }
    } catch(e) {
      addLog('error', `❌ 매도 실패: ${pos.ticker} — ${e.message}`);
    }
  } else {
    // 페이퍼: 현금 반환
    if (isUs) {
      STATE.paperBalanceUsd += investAmt + (investAmt * netPnlPct / 100);
    } else {
      STATE.paperBalance += Math.round(investAmt + profitAmt);
    }
  }

  STATE.stats.totalTrades++;
  if (isWin) STATE.stats.winTrades++;

  // 손익 원화 환산 (미국주식은 달러→원화 환산)
  const profitAmtKrw = isUs ? Math.round(profitAmt * STATE.usdKrw) : profitAmt;
  STATE.stats.totalProfit += profitAmtKrw;
  STATE.stats.dailyProfit += profitAmtKrw;

  STATE.profitHistory.push({ time: new Date().toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'}), cumProfit: STATE.stats.totalProfit });
  updateProfitChart();

  const icon  = isWin ? '✅' : '🚨';
  const color = isWin ? 'profit' : 'loss';
  const typeLabel = { profit: '익절', loss: '손절', trail: '트레일', time: '시간청산', close_eod: '장마감청산' }[exitType] || '청산';
  const mktFlag = isUs ? '🇺🇸' : '🇰🇷';
  const priceStr = isUs
    ? `$${pos.entryPrice.toFixed(2)} → $${actualExitPrice.toFixed(2)}`
    : `${fmtPrice(pos.entryPrice)} → ${fmtPrice(actualExitPrice)}`;
  const profitStr = isUs
    ? `$${(investAmt * netPnlPct / 100).toFixed(2)} (≈${fmtPrice(profitAmtKrw)}원)`
    : `${profitAmtKrw > 0 ? '+' : ''}${fmtPrice(profitAmtKrw)}원`;

  addLog(color, `${icon} ${mktFlag} [${typeLabel}] ${pos.name || pos.ticker} — ${reason}`);
  addLog(color, `   진입 ${priceStr} (슬리피지 -${slip}%)`);
  addLog(color, `   고점 +${(pos.peakPnl||0).toFixed(2)}% | 순손익 ${profitStr} (${netPnlPct > 0 ? '+' : ''}${netPnlPct.toFixed(2)}%)`);

  await recordTrade({
    ticker: pos.ticker, name: pos.name || pos.ticker,
    side: 'sell', entryPrice: pos.entryPrice, exitPrice: actualExitPrice,
    qty: pos.qty, pnlPct: netPnlPct, profitAmt: profitAmtKrw,
    peakPnl: pos.peakPnl || 0, slippage: slip, exitType, reason,
    timestamp: new Date().toISOString(), mode: STATE.mode, market: pos.market || 'KR',
    usdKrw: isUs ? STATE.usdKrw : 1,
  });
  await loadTradeHistory();

  STATE.recentResults.push({ win: isWin, pnlPct: netPnlPct });
  if (STATE.recentResults.length > 30) STATE.recentResults.shift(); // 최대 30회 보관
  calcAdaptiveMode(); // 10회 단위 평가
}

// 신규 진입 스캔
async function scanForEntries() {
  const mkt = STATE.market;
  let candidates = [];

  if (mkt === 'KR') {
    // 국내만
    if (isKrMarketOpen() || STATE.mode === 'paper') {
      candidates = await generateKrCandidates();
    }
  } else if (mkt === 'US') {
    // 미국만
    if (isUsMarketOpen() || STATE.mode === 'paper') {
      candidates = await generateUsCandidates();
    }
  } else { // BOTH
    // 열린 시장 쪽만 스캔 (동시 개장 시 둘 다)
    const krSlots = Math.ceil(STATE.config.maxPositions * (1 - STATE.config.usRatio));
    const usSlots = Math.floor(STATE.config.maxPositions * STATE.config.usRatio);
    const krPosCount = STATE.positions.filter(p => p.market !== 'US').length;
    const usPosCount = STATE.positions.filter(p => p.market === 'US').length;

    if ((isKrMarketOpen() || STATE.mode === 'paper') && krPosCount < krSlots) {
      const krCands = await generateKrCandidates();
      candidates.push(...krCands.slice(0, krSlots - krPosCount));
    }
    if ((isUsMarketOpen() || STATE.mode === 'paper') && usPosCount < usSlots) {
      const usCands = await generateUsCandidates();
      candidates.push(...usCands.slice(0, usSlots - usPosCount));
    }
  }

  STATE.candidates = candidates;
  addLog('scan', `   후보 ${candidates.length}개 발견 (${mkt})`);
  for (const c of candidates) {
    if (STATE.positions.length >= STATE.config.maxPositions) break;
    if (STATE.positions.find(p => p.ticker === c.ticker)) continue;
    await executeEntry(c);
  }
}

// ─── 국내주식 후보 종목 스캔 ─────────────────────────────────
async function generateKrCandidates() {
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

// ─── 미국주식 후보 종목 스캔 ─────────────────────────────────
async function generateUsCandidates() {
  const strategy = document.getElementById('strategy-select').value || STATE.strategy;
  const ap = (ADAPTIVE_PARAMS[strategy] || ADAPTIVE_PARAMS.scalping)[STATE.adaptiveMode];

  // 나스닥100 + S&P500 주요 종목 고정 리스트
  const US_STOCKS = [
    // 나스닥 대형주
    { ticker: 'AAPL',  name: 'Apple',         basePrice: 228,  excd: 'NAS' },
    { ticker: 'MSFT',  name: 'Microsoft',     basePrice: 430,  excd: 'NAS' },
    { ticker: 'NVDA',  name: 'NVIDIA',        basePrice: 130,  excd: 'NAS' },
    { ticker: 'AMZN',  name: 'Amazon',        basePrice: 195,  excd: 'NAS' },
    { ticker: 'GOOGL', name: 'Alphabet',      basePrice: 175,  excd: 'NAS' },
    { ticker: 'META',  name: 'Meta',          basePrice: 560,  excd: 'NAS' },
    { ticker: 'TSLA',  name: 'Tesla',         basePrice: 250,  excd: 'NAS' },
    { ticker: 'AVGO',  name: 'Broadcom',      basePrice: 185,  excd: 'NAS' },
    { ticker: 'AMD',   name: 'AMD',           basePrice: 145,  excd: 'NAS' },
    { ticker: 'INTC',  name: 'Intel',         basePrice: 22,   excd: 'NAS' },
    // NYSE 대형주
    { ticker: 'JPM',   name: 'JPMorgan',      basePrice: 245,  excd: 'NYS' },
    { ticker: 'V',     name: 'Visa',          basePrice: 280,  excd: 'NYS' },
    { ticker: 'XOM',   name: 'ExxonMobil',    basePrice: 115,  excd: 'NYS' },
    { ticker: 'BRK.B', name: 'Berkshire B',   basePrice: 460,  excd: 'NYS' },
    { ticker: 'UNH',   name: 'UnitedHealth',  basePrice: 530,  excd: 'NYS' },
    { ticker: 'JNJ',   name: 'J&J',           basePrice: 160,  excd: 'NYS' },
    { ticker: 'WMT',   name: 'Walmart',       basePrice: 88,   excd: 'NYS' },
    { ticker: 'MA',    name: 'Mastercard',    basePrice: 530,  excd: 'NYS' },
    { ticker: 'PG',    name: 'P&G',           basePrice: 165,  excd: 'NYS' },
    { ticker: 'LLY',   name: 'Eli Lilly',     basePrice: 790,  excd: 'NYS' },
  ];

  // 실전 모드: KIS API로 현재가 조회 후 필터링
  if (STATE.mode === 'live' && KEYS.appKey) {
    try {
      const shuffled = [...US_STOCKS].sort(() => Math.random() - 0.5).slice(0, 10);
      const results = await Promise.all(shuffled.map(async (s) => {
        try {
          const res = await fetch('/api/kis/us/price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appKey: KEYS.appKey, appSecret: KEYS.appSecret,
              symbol: s.ticker, excd: s.excd,
            }),
          });
          const data = await res.json();
          if (data.ok && data.price > 0) {
            return { ...s, price: data.price, pctChange: data.changeRate, volume: data.volume };
          }
        } catch {}
        return null;
      }));
      const valid = results.filter(Boolean);
      if (valid.length > 0) {
        const filtered = valid.filter(item => {
          const pct = item.pctChange || 0;
          if (strategy === 'scalping')       return pct > ap.pctMin && pct < ap.pctMax;
          if (strategy === 'volume')         return pct > 0;
          if (strategy === 'momentum')       return pct > ap.pctMin;
          if (strategy === 'mean_reversion') return pct < ap.pctMin;
          return true;
        });
        const candidates = filtered.slice(0, 3).map(item => ({
          ticker:    item.ticker,
          name:      item.name,
          price:     item.price,
          pctChange: item.pctChange,
          score:     Math.random() * 30 + 60 + (ap.scoreBonus || 0),
          market:    'US',
          excd:      item.excd,
        }));
        if (candidates.length > 0) {
          addLog('scan', `   🇺🇸 미국주식 후보 ${candidates.length}개 (실시간)`);
          return candidates;
        }
      }
    } catch(e) {
      addLog('warn', '⚠️ 미국주식 시세 조회 실패 — 시뮬레이션 사용: ' + e.message);
    }
  }

  // 페이퍼 모드 또는 API 실패: 시뮬레이션
  return generateUsSimCandidates(strategy, ap);
}

function generateUsSimCandidates(strategy, ap) {
  const US_STOCKS = [
    { ticker: 'AAPL',  name: 'Apple',         basePrice: 228 },
    { ticker: 'MSFT',  name: 'Microsoft',     basePrice: 430 },
    { ticker: 'NVDA',  name: 'NVIDIA',        basePrice: 130 },
    { ticker: 'AMZN',  name: 'Amazon',        basePrice: 195 },
    { ticker: 'GOOGL', name: 'Alphabet',      basePrice: 175 },
    { ticker: 'META',  name: 'Meta',          basePrice: 560 },
    { ticker: 'TSLA',  name: 'Tesla',         basePrice: 250 },
    { ticker: 'AMD',   name: 'AMD',           basePrice: 145 },
    { ticker: 'JPM',   name: 'JPMorgan',      basePrice: 245 },
    { ticker: 'INTC',  name: 'Intel',         basePrice: 22  },
  ];
  const adap = ap || (ADAPTIVE_PARAMS[strategy] || ADAPTIVE_PARAMS.scalping)[STATE.adaptiveMode];
  const results = [];
  const shuffled = [...US_STOCKS].sort(() => Math.random() - 0.5);

  for (const s of shuffled.slice(0, 7)) {
    // 달러 소수점 변동 시뮬레이션
    const pctChange   = (Math.random() - 0.3) * 4;
    const volMult     = 1 + Math.random() * 3;
    const rsi         = 30 + Math.random() * 50;
    const buyPressure = 0.8 + Math.random() * 0.8;
    const price       = Math.round(s.basePrice * (1 + pctChange / 100) * 100) / 100;

    let pass = false;
    if (strategy === 'scalping') {
      pass = pctChange > adap.pctMin && pctChange < adap.pctMax
          && rsi > (adap.rsiMin || 35) && rsi < (adap.rsiMax || 65)
          && volMult >= (adap.volMult || 1.5)
          && buyPressure >= (adap.buyPressure || 1.2);
    } else if (strategy === 'volume') {
      pass = volMult >= adap.volMult && pctChange > 0 && rsi < (adap.rsiMax || 70);
    } else if (strategy === 'momentum') {
      pass = pctChange > adap.pctMin && volMult >= adap.volMult;
    } else if (strategy === 'mean_reversion') {
      pass = pctChange < adap.pctMin && rsi < (adap.rsiMax || 30);
    }

    if (pass) {
      results.push({
        ticker:    s.ticker,
        name:      s.name,
        price,
        pctChange: parseFloat(pctChange.toFixed(2)),
        volume:    Math.round(1000000 * volMult),
        rsi:       parseFloat(rsi.toFixed(1)),
        score:     Math.min(100, Math.max(0, Math.round(50 + Math.random() * 40) + (adap.scoreBonus || 0))),
        market:    'US',
      });
    }
  }
  return results;
}

// 매수 실행 (국내/미국 통합)
async function executeEntry(candidate) {
  const isUs = candidate.market === 'US';

  // ── 가용 자금 조회 ─────────────────────────────────────
  let available;
  if (STATE.mode === 'paper') {
    available = isUs ? (STATE.paperBalanceUsd * STATE.usdKrw) : STATE.paperBalance;
  } else {
    if (isUs) {
      available = (await getUsLiveBalance()) * STATE.usdKrw; // 달러→원화 환산 비교용
      if (available > 0) { STATE.liveBalanceUsd = available / STATE.usdKrw; STATE.liveBalanceUsdTs = Date.now(); }
    } else {
      available = await getLiveBalance();
      if (available > 0) { STATE.liveBalance = available; STATE.liveBalanceTs = Date.now(); }
    }
  }
  if (available < 10000) {
    addLog('warn', `⚠️ 가용 자금 부족: ${isUs ? '$'+(available/STATE.usdKrw).toFixed(0) : fmtPrice(available)+'원'}`);
    return;
  }

  // ── 포지션 금액 계산 ───────────────────────────────────
  const posMin     = STATE.config.posMinAmt  || 50000;
  const posMaxBase = STATE.config.posMaxAmt  || 150000;
  const posCapMult = STATE.config.posCapMult || 1.0;
  const posMaxFinal= Math.round(posMaxBase * posCapMult / 10000) * 10000;
  if (available < posMin) {
    addLog('warn', `⚠️ 가용 현금 부족 (${fmtManwon(available)} < 최소 ${fmtManwon(posMin)})`);
    return;
  }
  const score     = (candidate.score || 70) / 100;
  const rawAmt    = posMin + Math.round((posMaxFinal - posMin) * score);
  const investAmt = Math.min(rawAmt, available, posMaxFinal);
  if (investAmt < 10000) return;

  // 수량 계산
  const price = candidate.price || 1;
  const qty   = isUs
    ? Math.floor((investAmt / STATE.usdKrw) / price * 100) / 100 // 달러 수량 (소수점 가능)
    : Math.floor(investAmt / price);
  const qtyInt = Math.floor(qty); // 미국도 정수 수량 (KIS API 제약)
  if (qtyInt < 1) { addLog('warn', `⚠️ 수량 부족: ${candidate.ticker} $${price} — 최소 1주 필요`); return; }

  // ── 실전 주문 실행 ─────────────────────────────────────
  if (STATE.mode === 'live') {
    try {
      if (isUs) {
        const excd = getUsExchangeCode(candidate.ticker).replace('NAS','NASD').replace('NYS','NYSE');
        const res = await fetch('/api/kis/us/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appKey: KEYS.appKey, appSecret: KEYS.appSecret, accountNo: KEYS.accountNo,
            symbol: candidate.ticker, excd,
            side: 'buy', qty: qtyInt,
            price: price.toFixed(2), // 지정가 (달러, 소수점 2자리)
          }),
        });
        const data = await res.json();
        if (data.serverBlocked) { addLog('warn', `⚠️ 미국 매수 서버 차단: ${candidate.ticker}`); return; }
        if (!data.ok) throw new Error(data.error || JSON.stringify(data));
      } else {
        const res = await fetch('/api/kis/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appKey: KEYS.appKey, appSecret: KEYS.appSecret, accountNo: KEYS.accountNo,
            ticker: candidate.ticker, side: 'buy', qty: qtyInt,
          }),
        });
        const data = await res.json();
        if (data.serverBlocked) { addLog('warn', `⚠️ 매수 서버 차단: ${candidate.ticker}`); return; }
        if (!data.ok) throw new Error(data.error || JSON.stringify(data));
      }
    } catch(e) {
      addLog('error', `❌ 매수 실패: ${candidate.ticker} — ${e.message}`);
      return;
    }
  } else {
    // 페이퍼 모드: 잔고 차감
    if (isUs) {
      STATE.paperBalanceUsd -= qtyInt * price;
    } else {
      STATE.paperBalance -= qtyInt * price;
    }
  }

  const pos = {
    ticker:       candidate.ticker,
    name:         candidate.name || candidate.ticker,
    entryPrice:   price,
    qty:          qtyInt,
    entryTime:    Date.now(),
    currentPrice: price,
    pnlPct:       0,
    peakPnl:      0,
    trailArmed:   false,
    score:        candidate.score,
    market:       candidate.market || 'KR', // 'KR' | 'US'
  };
  STATE.positions.push(pos);

  const mktFlag = isUs ? '🇺🇸' : '🇰🇷';
  const priceStr = isUs ? `$${price.toFixed(2)}` : fmtPrice(price) + '원';
  const amtStr   = isUs
    ? `$${(qtyInt * price).toFixed(2)} (≈${fmtManwon(Math.round(qtyInt * price * STATE.usdKrw))})`
    : fmtManwon(qtyInt * price);
  addLog('buy', `💰 ${mktFlag} 매수: ${pos.name} (${pos.ticker})`);
  addLog('buy', `   진입가 ${fmtPrice(pos.entryPrice)}원 | ${qty}주 | 투자 ${fmtPrice(qty * price)}원 (범위: ${fmtManwon(posMin)}~${fmtManwon(posMaxFinal)})`);
  renderPositions();
  updateStatsUI(); // 매수 즉시 총자산 카드 반영
}

// ─── 실시간 포지션 가격 업데이트 ──────────────────────────────
async function tickPositions() {
  // ── 국내 실전 잔고 30초마다 폴링 ─────────────────────────
  if (STATE.mode === 'live' && KEYS.appKey && KEYS.accountNo) {
    if ((STATE.market === 'KR' || STATE.market === 'BOTH')) {
      const elapsed = Date.now() - STATE.liveBalanceTs;
      if (!STATE.liveBalanceFetching && elapsed > 30000) {
        STATE.liveBalanceFetching = true;
        if (STATE.liveBalanceTs === 0) {
          const cashEl = document.getElementById('stat-cash');
          if (cashEl) cashEl.textContent = '조회 중…';
        }
        getLiveBalance().then(bal => {
          const prev = STATE.liveBalance;
          STATE.liveBalance   = bal;
          STATE.liveBalanceTs = Date.now();
          STATE.liveBalanceFetching = false;
          if (bal > 0 && bal !== prev) { addLog('info', `💰 국내 잔고 갱신: ${fmtPrice(bal)}원`); updateStatsUI(); }
          else if (bal === 0 && prev > 0) updateStatsUI();
        }).catch(() => { STATE.liveBalanceFetching = false; });
      }
    }
    // ── 미국 달러 잔고 30초마다 폴링 ───────────────────────
    if ((STATE.market === 'US' || STATE.market === 'BOTH')) {
      const elapsedUsd = Date.now() - STATE.liveBalanceUsdTs;
      if (!STATE.liveBalanceUsdFetching && elapsedUsd > 30000) {
        STATE.liveBalanceUsdFetching = true;
        getUsLiveBalance().then(usd => {
          const prev = STATE.liveBalanceUsd;
          STATE.liveBalanceUsd    = usd;
          STATE.liveBalanceUsdTs  = Date.now();
          STATE.liveBalanceUsdFetching = false;
          if (usd > 0 && Math.abs(usd - prev) > 0.01) {
            addLog('info', `💵 미국 달러 잔고 갱신: $${usd.toFixed(2)} (≈${fmtPrice(Math.round(usd * STATE.usdKrw))}원)`);
            updateStatsUI();
          }
        }).catch(() => { STATE.liveBalanceUsdFetching = false; });
      }
    }
  }

  if (STATE.positions.length === 0) return;

  for (const pos of STATE.positions) {
    const price = await fetchCurrentPrice(pos.ticker, pos.market);
    if (price) {
      pos.currentPrice = price;
      pos.pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      if (pos.pnlPct > (pos.peakPnl || 0)) pos.peakPnl = pos.pnlPct;
    }
  }
  renderPositions();
  updateStatsUI();
}

async function fetchCurrentPrice(ticker, market) {
  const mkt = market || (STATE.positions.find(p => p.ticker === ticker)?.market) || 'KR';
  if (mkt === 'US') {
    return await fetchUsCurrentPrice(ticker);
  }
  // 국내주식
  if (STATE.mode === 'live' && KEYS.appKey) {
    try {
      const res = await axios.get(`/api/naver/price/${ticker}`, { timeout: 4000 });
      return res.data?.price || null;
    } catch { return null; }
  }
  // 페이퍼: 시뮬레이션
  const pos = STATE.positions.find(p => p.ticker === ticker);
  if (!pos) return null;
  const drift = (Math.random() - 0.48) * pos.entryPrice * 0.003;
  return Math.round(pos.currentPrice + drift);
}

/** 미국주식 현재가 조회 (달러) */
async function fetchUsCurrentPrice(symbol) {
  if (STATE.mode === 'live' && KEYS.appKey) {
    try {
      const excd = getUsExchangeCode(symbol);
      const res = await fetch('/api/kis/us/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: KEYS.appKey, appSecret: KEYS.appSecret, symbol, excd }),
      });
      const data = await res.json();
      if (data.ok && data.price > 0) return data.price;
    } catch {}
  }
  // 페이퍼: 시뮬레이션 (달러 기반 소폭 변동)
  const pos = STATE.positions.find(p => p.ticker === symbol);
  if (!pos) return null;
  const drift = (Math.random() - 0.48) * pos.entryPrice * 0.002;
  return Math.round((pos.currentPrice + drift) * 100) / 100; // 소수점 2자리
}

/** 미국주식 거래소 코드 추론 (NASD=나스닥, NYSE=뉴욕) */
function getUsExchangeCode(symbol) {
  // 나스닥 대표 종목
  const nasd = ['AAPL','MSFT','AMZN','GOOGL','GOOG','META','NVDA','TSLA','AVGO','COST',
    'NFLX','AMD','INTC','QCOM','AMAT','MU','LRCX','KLAC','MRVL','ADI',
    'PYPL','SBUX','GILD','REGN','VRTX','IDXX','BIIB','ILMN','ALGN','SGEN',
    'PANW','FTNT','CDNS','SNPS','ANSS','CTSH','FISV','PAYX','FAST','CTAS'];
  return nasd.includes(symbol.toUpperCase()) ? 'NAS' : 'NYS';
}

async function getLiveBalance() {
  if (!KEYS.appKey || !KEYS.accountNo) return STATE.liveBalance;
  try {
    const res = await fetch('/api/kis/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: KEYS.appKey, appSecret: KEYS.appSecret, accountNo: KEYS.accountNo }),
    });
    const data = await res.json();
    if (data.serverBlocked) {
      addLog('warn', '⚠️ 서버→KIS 연결 차단 — 실전 잔고 조회 불가');
      return STATE.liveBalance;
    }
    return data.balance || 0;
  } catch {
    return STATE.liveBalance;
  }
}

/** 미국주식 달러 잔고 조회 */
async function getUsLiveBalance() {
  if (!KEYS.appKey || !KEYS.accountNo) return STATE.liveBalanceUsd;
  try {
    const res = await fetch('/api/kis/us/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: KEYS.appKey, appSecret: KEYS.appSecret, accountNo: KEYS.accountNo }),
    });
    const data = await res.json();
    if (data.serverBlocked) {
      addLog('warn', '⚠️ 서버→KIS 연결 차단 — 미국주식 잔고 조회 불가');
      return STATE.liveBalanceUsd;
    }
    return data.cashUsd || 0;
  } catch {
    return STATE.liveBalanceUsd;
  }
}

/** 원/달러 환율 조회 + 캐시 */
async function fetchUsdKrw() {
  // 5분 캐시
  if (STATE.usdKrwTs && Date.now() - STATE.usdKrwTs < 5 * 60 * 1000) return STATE.usdKrw;
  try {
    const res = await fetch('/api/forex/usd-krw', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.ok && data.rate > 0) {
      STATE.usdKrw   = data.rate;
      STATE.usdKrwTs = Date.now();
      // 환율 표시 업데이트
      const fxEl = document.getElementById('fx-rate-display');
      if (fxEl) fxEl.textContent = `$1 = ${fmtPrice(data.rate)}원`;
      addLog('info', `💱 환율 갱신: $1 = ${fmtPrice(data.rate)}원 (출처: ${data.source})`);
    }
  } catch {}
  return STATE.usdKrw;
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
    const mkt = STATE.market;
    // 국내 포지션 평가금
    const stockValKr  = STATE.positions.filter(p => p.market !== 'US').reduce((s,p) => s + p.currentPrice * p.qty, 0);
    // 미국 포지션 평가금 (달러 → 원화)
    const stockValUsd = STATE.positions.filter(p => p.market === 'US').reduce((s,p) => s + p.currentPrice * p.qty, 0);
    const stockValUsdKrw = Math.round(stockValUsd * STATE.usdKrw);

    let totalAsset, cashDisplay, stockDisplay;
    if (mkt === 'US') {
      totalAsset   = Math.round((STATE.paperBalanceUsd + stockValUsd) * STATE.usdKrw);
      cashDisplay  = `$${STATE.paperBalanceUsd.toFixed(2)} (≈${fmtPrice(Math.round(STATE.paperBalanceUsd * STATE.usdKrw))}원)`;
      stockDisplay = stockValUsd > 0 ? `$${stockValUsd.toFixed(2)} (≈${fmtPrice(stockValUsdKrw)}원)` : '없음';
    } else if (mkt === 'BOTH') {
      totalAsset   = STATE.paperBalance + stockValKr + Math.round(STATE.paperBalanceUsd * STATE.usdKrw) + stockValUsdKrw;
      cashDisplay  = `${fmtPrice(STATE.paperBalance)}원 / $${STATE.paperBalanceUsd.toFixed(2)}`;
      stockDisplay = (stockValKr + stockValUsdKrw) > 0 ? fmtPrice(stockValKr + stockValUsdKrw) + '원' : '없음';
    } else {
      totalAsset   = STATE.paperBalance + stockValKr;
      cashDisplay  = fmtPrice(STATE.paperBalance) + '원';
      stockDisplay = stockValKr > 0 ? fmtPrice(stockValKr) + '원' : '없음';
    }

    const initialCap = STATE.config.paperCapital;
    // 총자산 표시
    document.getElementById('stat-total-asset').textContent = fmtPrice(totalAsset) + '원';
    // 자산 변동 색상
    const assetEl = document.getElementById('stat-total-asset');
    const assetDiff = totalAsset - initialCap;
    assetEl.className = 'text-2xl font-bold ' + (assetDiff >= 0 ? 'text-white' : 'text-red-300') + ' tracking-tight';
    // 현금 / 주식평가 (시장 모드별 표시)
    document.getElementById('stat-cash').textContent        = cashDisplay;
    document.getElementById('stat-stock-value').textContent = stockDisplay;
    // 배지
    document.getElementById('stat-asset-badge').textContent = '페이퍼';
    // 진행 바: 현재자산 / 초기자산 비율
    const barPct = Math.min((totalAsset / Math.max(initialCap, 1)) * 100, 200);
    const barEl  = document.getElementById('stat-asset-bar');
    barEl.style.width      = Math.min(barPct, 100) + '%';
    barEl.className = 'h-0.5 rounded transition-all duration-500 ' + (assetDiff >= 0 ? 'bg-green-500' : 'bg-red-500');
  } else {
    // ── 실전 모드 — 캐시된 잔고 + 보유주식 평가금 합산 표시 ──
    const mkt       = STATE.market;
    const cash      = STATE.liveBalance;       // 캐시된 현금 잔고 (원화)
    const cashUsd   = STATE.liveBalanceUsd;    // 달러 현금 잔고
    const fetching  = STATE.liveBalanceFetching;
    const fetchingUsd = STATE.liveBalanceUsdFetching;

    // 달러 포지션 평가금 (원화 환산)
    const stockValKr  = STATE.positions.filter(p => p.market !== 'US').reduce((s,p) => s + p.currentPrice * p.qty, 0);
    const stockValUsd = STATE.positions.filter(p => p.market === 'US').reduce((s,p) => s + p.currentPrice * p.qty, 0);
    const stockValUsdKrw = Math.round(stockValUsd * STATE.usdKrw);

    // 총자산 계산
    let totalAsset = 0;
    if (mkt === 'KR')   totalAsset = cash + stockValKr;
    else if (mkt === 'US')  totalAsset = Math.round(cashUsd * STATE.usdKrw) + stockValUsdKrw;
    else                totalAsset = cash + stockValKr + Math.round(cashUsd * STATE.usdKrw) + stockValUsdKrw;

    const hasCash   = cash > 0 || cashUsd > 0;
    const hasStock  = stockValKr > 0 || stockValUsd > 0;

    // 총 자산 표시
    const assetEl = document.getElementById('stat-total-asset');
    if ((fetching || fetchingUsd) && !hasCash) {
      assetEl.textContent = '조회 중…';
      assetEl.className = 'text-2xl font-bold text-yellow-400 tracking-tight';
    } else if (hasCash || hasStock) {
      assetEl.textContent = fmtPrice(totalAsset) + '원';
      assetEl.className = 'text-2xl font-bold text-white tracking-tight';
    } else {
      assetEl.textContent = '계좌 연결 필요';
      assetEl.className = 'text-2xl font-bold text-gray-500 tracking-tight';
    }

    // 현금 잔고 표시
    const cashEl = document.getElementById('stat-cash');
    if (mkt === 'US') {
      // 미국 모드: 달러 잔고 표시
      if (fetchingUsd && cashUsd === 0) {
        cashEl.textContent = '조회 중…';
      } else if (cashUsd > 0) {
        cashEl.textContent = `$${cashUsd.toFixed(2)} (≈${fmtPrice(Math.round(cashUsd * STATE.usdKrw))}원)`;
      } else {
        cashEl.textContent = '미연결';
      }
    } else if (mkt === 'BOTH') {
      // BOTH 모드: 원화 + 달러 합산
      const krPart = cash > 0 ? fmtPrice(cash) + '원' : '';
      const usPart = cashUsd > 0 ? `$${cashUsd.toFixed(0)}` : '';
      if (fetching && cash === 0 && fetchingUsd && cashUsd === 0) {
        cashEl.textContent = '조회 중…';
      } else if (krPart || usPart) {
        cashEl.textContent = [krPart, usPart].filter(Boolean).join(' / ');
      } else {
        cashEl.textContent = '미연결';
      }
    } else {
      // KR 모드
      if (fetching && !cash) {
        cashEl.textContent = '조회 중…';
      } else if (cash) {
        cashEl.textContent = fmtPrice(cash) + '원';
      } else {
        cashEl.textContent = '미연결';
      }
    }

    // 주식 평가금 표시
    const stockDisplayVal = mkt === 'US' ? stockValUsdKrw : mkt === 'BOTH' ? (stockValKr + stockValUsdKrw) : stockValKr;
    document.getElementById('stat-stock-value').textContent = stockDisplayVal > 0 ? fmtPrice(stockDisplayVal) + '원' : '-';

    // 배지 + 진행 바 (실전)
    document.getElementById('stat-asset-badge').textContent = '실전';
    document.getElementById('stat-asset-badge').className   = 'text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-400';

    // 진행 바 (잔고 대비 주식 비중)
    const barEl = document.getElementById('stat-asset-bar');
    if (totalAsset > 0) {
      const barPct = Math.min((stockDisplayVal / totalAsset) * 100, 100);
      barEl.style.width = barPct + '%';
      barEl.className = 'h-0.5 rounded transition-all duration-500 bg-red-400';
    } else {
      barEl.style.width = '0%';
      barEl.className = 'h-0.5 rounded transition-all duration-500 bg-gray-600';
    }
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
// ─── 장 시간 판별 ─────────────────────────────────────────────
// 모든 시간은 브라우저 로컬 시간 기준 (한국 사용자 = KST)

/** 국내 정규장 여부 (평일 09:00~15:30 KST) */
function isKrMarketOpen() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const min = now.getHours() * 60 + now.getMinutes();
  return min >= 9 * 60 && min <= 15 * 60 + 30;
}

/** 국내 장 마감 30분 전 여부 (15:00~15:30 KST) */
function isKrMarketClosingSoon() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const min = now.getHours() * 60 + now.getMinutes();
  return min >= 15 * 60 && min <= 15 * 60 + 30;
}

/** 미국 야간 정규장 여부 (평일+토요일 23:30~06:00 KST)
 *  - 미국 장 : EST 09:30~16:00 = KST 23:30~06:00
 *  - 토요일 00:00~06:00 도 포함 (금요일 뉴욕장 연속)
 */
function isUsMarketOpen() {
  const now = new Date();
  const day = now.getDay(); // 0=일, 6=토
  const h = now.getHours(), m = now.getMinutes();
  const min = h * 60 + m;
  // 일요일은 완전 마감
  if (day === 0) return false;
  // 평일(월~금): 23:30 이후 또는 00:00~06:00
  if (day >= 1 && day <= 5) {
    return min >= 23 * 60 + 30 || min <= 6 * 60;
  }
  // 토요일: 00:00~06:00 (금요일 뉴욕장 마지막)
  if (day === 6) {
    return min <= 6 * 60;
  }
  return false;
}

/** 미국 장 마감 30분 전 여부 (05:30~06:00 KST) */
function isUsMarketClosingSoon() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0) return false;
  const min = now.getHours() * 60 + now.getMinutes();
  // 06:00 기준 30분 전 = 05:30~06:00
  return min >= 5 * 60 + 30 && min <= 6 * 60;
}

/** 현재 시장 모드에서 신규 진입 가능한지 */
function isMarketOpen() {
  const mkt = STATE.market;
  if (mkt === 'KR')   return isKrMarketOpen();
  if (mkt === 'US')   return isUsMarketOpen();
  if (mkt === 'BOTH') return isKrMarketOpen() || isUsMarketOpen();
  return false;
}

/** 다음 개장 시각 문자열 */
function getNextOpenStr() {
  const now = new Date();
  const mkt = STATE.market;
  if (mkt === 'US') {
    // 다음 미국 야간 정규장: 당일 23:30 또는 다음 평일 23:30
    const day = now.getDay();
    const min = now.getHours() * 60 + now.getMinutes();
    let daysAdd = 0;
    // 이미 당일 23:30 이전이면 오늘 23:30
    if (min < 23 * 60 + 30 && day >= 1 && day <= 5) daysAdd = 0;
    // 아니면 다음날
    else daysAdd = 1;
    // 일~금 → 다음 평일
    const next = new Date(now);
    next.setDate(next.getDate() + daysAdd);
    // 주말 건너뜀
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    next.setHours(23, 30, 0, 0);
    return `${String(next.getMonth()+1).padStart(2,'0')}/${String(next.getDate()).padStart(2,'0')} 23:30`;
  }
  // 국내 기본
  const d = now.getDay();
  const next = new Date(now);
  next.setDate(next.getDate() + (d === 0 ? 1 : d === 6 ? 2 : 1));
  next.setHours(9, 0, 0, 0);
  return `${String(next.getMonth()+1).padStart(2,'0')}/${String(next.getDate()).padStart(2,'0')} 09:00`;
}

function updateMarketStatus() {
  const dot   = document.getElementById('market-dot');
  const label = document.getElementById('market-label');
  if (!dot || !label) return;

  const mkt = STATE.market;
  const krOpen = isKrMarketOpen();
  const usOpen = isUsMarketOpen();
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const day = now.getDay();
  const isWeekday = day >= 1 && day <= 5;

  if (mkt === 'KR') {
    const preOpen  = isWeekday && h === 8 && m >= 30;
    const afterHour= isWeekday && ((h === 15 && m > 30) || (h >= 16 && h < 18));
    if (krOpen) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500 running-indicator';
      label.textContent = '🇰🇷 정규장 (09:00~15:30)';
      label.className = 'text-green-400 text-sm';
    } else if (preOpen) {
      dot.className = 'w-2 h-2 rounded-full bg-yellow-400';
      label.textContent = '🟡 장 전 시간외 (08:30~09:00)';
      label.className = 'text-yellow-400 text-sm';
    } else if (afterHour) {
      dot.className = 'w-2 h-2 rounded-full bg-blue-400';
      label.textContent = '🔵 장 후 시간외 (15:30~18:00)';
      label.className = 'text-blue-400 text-sm';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-gray-500';
      label.textContent = `⚫ 장 마감 (다음 ${getNextOpenStr()})`;
      label.className = 'text-gray-400 text-sm';
    }
  } else if (mkt === 'US') {
    if (usOpen) {
      dot.className = 'w-2 h-2 rounded-full bg-blue-400 running-indicator';
      label.textContent = '🇺🇸 미국 야간장 (23:30~06:00)';
      label.className = 'text-blue-400 text-sm';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-gray-500';
      label.textContent = `🇺🇸 미국장 마감 (다음 ${getNextOpenStr()})`;
      label.className = 'text-gray-400 text-sm';
    }
  } else { // BOTH
    if (krOpen && usOpen) {
      dot.className = 'w-2 h-2 rounded-full bg-green-400 running-indicator';
      label.textContent = '🌏 국내+미국 동시 개장';
      label.className = 'text-green-400 text-sm';
    } else if (krOpen) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500 running-indicator';
      label.textContent = '🇰🇷 국내 정규장 (미국 마감)';
      label.className = 'text-green-400 text-sm';
    } else if (usOpen) {
      dot.className = 'w-2 h-2 rounded-full bg-blue-400 running-indicator';
      label.textContent = '🇺🇸 미국 야간장 (국내 마감)';
      label.className = 'text-blue-400 text-sm';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-gray-500';
      label.textContent = `⚫ 모든 장 마감 (다음 ${getNextOpenStr()})`;
      label.className = 'text-gray-400 text-sm';
    }
  }

  // 환율 표시 업데이트
  const fxEl = document.getElementById('fx-rate-display');
  if (fxEl && STATE.market !== 'KR') {
    fxEl.textContent = `$1 = ${fmtPrice(STATE.usdKrw)}원`;
  }
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
