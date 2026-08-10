import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  KV: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './public' }))
app.use('/favicon.svg', serveStatic({ root: './public' }))

// favicon.ico → SVG 리다이렉트
app.get('/favicon.ico', (c) => c.redirect('/favicon.svg', 301))

// ─────────────────────────────────────────────
// KIS API 헬퍼
// ─────────────────────────────────────────────
async function getKisToken(env: Bindings & Record<string, string>, appKey: string, appSecret: string): Promise<string> {
  try {
    const cacheKey = 'kis_token_' + appKey.slice(-8)
    const cached = await env.KV?.get(cacheKey)
    if (cached) return cached

    const res = await fetch('https://openapi.koreainvestment.com:9443/oauth2/tokenP', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: appKey,
        appsecret: appSecret,
      }),
    })
    const data: any = await res.json()
    const token = data.access_token
    if (token && env.KV) {
      // 토큰 만료 전 23시간 캐시
      await env.KV.put(cacheKey, token, { expirationTtl: 82800 })
    }
    return token
  } catch {
    return ''
  }
}

// 국내 주식 현재가 조회
async function getStockPrice(token: string, appKey: string, appSecret: string, ticker: string) {
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'FHKST01010100',
      custtype: 'P',
    },
  })
  return res.json()
}

// 국내 주식 일봉 조회 (최근 30일)
async function getDayCandles(token: string, appKey: string, appSecret: string, ticker: string) {
  const today = new Date()
  const endDate = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startD = new Date(today); startD.setDate(startD.getDate() - 60)
  const startDate = startD.toISOString().slice(0, 10).replace(/-/g, '')
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}&fid_period_div_code=D&fid_org_adj_prc=0&fid_input_date_1=${startDate}&fid_input_date_2=${endDate}`
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'FHKST01010400',
      custtype: 'P',
    },
  })
  return res.json()
}

// 거래량 순위 (상위 20개)
async function getVolumeRank(token: string, appKey: string, appSecret: string) {
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/volume-rank?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20171&fid_input_iscd=0000&fid_div_cls_code=0&fid_blng_cls_code=0&fid_trgt_cls_code=111111111&fid_trgt_exls_cls_code=000000&fid_input_price_1=&fid_input_price_2=&fid_vol_cnt=&fid_input_date_1=0`
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'FHPST01710000',
      custtype: 'P',
    },
  })
  return res.json()
}

// 잔고 조회
async function getBalance(token: string, appKey: string, appSecret: string, accountNo: string) {
  const [cano, acntPrdtCd] = accountNo.split('-')
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${cano}&ACNT_PRDT_CD=${acntPrdtCd}&AFHR_FLPR_YN=N&OFL_YN=&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=00&CTX_AREA_FK100=&CTX_AREA_NK100=`
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'TTTC8434R',
      custtype: 'P',
    },
  })
  return res.json()
}

// 주문 (매수/매도)
async function placeOrder(token: string, appKey: string, appSecret: string, accountNo: string, ticker: string, qty: number, price: number, orderType: 'buy' | 'sell', priceType: 'market' | 'limit') {
  const [cano, acntPrdtCd] = accountNo.split('-')
  const trId = orderType === 'buy' ? 'TTTC0802U' : 'TTTC0801U'
  const ordDvsn = priceType === 'market' ? '01' : '00'
  const ordPrc = priceType === 'market' ? '0' : String(Math.round(price))

  const res = await fetch('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId,
      custtype: 'P',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      PDNO: ticker,
      ORD_DVSN: ordDvsn,
      ORD_QTY: String(qty),
      ORD_UNPR: ordPrc,
    }),
  })
  return res.json()
}

// ─────────────────────────────────────────────
// API 라우트
// ─────────────────────────────────────────────

// 토큰 발급
app.post('/api/auth/token', async (c) => {
  const { appKey, appSecret } = await c.req.json()
  if (!appKey || !appSecret) return c.json({ error: 'appKey, appSecret 필수' }, 400)
  const token = await getKisToken({ ...c.env, appKey, appSecret }, appKey, appSecret)
  if (!token) return c.json({ error: '토큰 발급 실패' }, 500)
  return c.json({ token: token.slice(0, 20) + '...', ok: true })
})

// 주식 현재가
app.get('/api/stock/price/:ticker', async (c) => {
  const { appKey, appSecret } = getApiKeys(c.req.header())
  if (!appKey) return c.json({ error: 'API 키 필요' }, 401)
  const token = await getKisToken(c.env as any, appKey, appSecret)
  const data = await getStockPrice(token, appKey, appSecret, c.req.param('ticker'))
  return c.json(data)
})

// 일봉 차트
app.get('/api/stock/candles/:ticker', async (c) => {
  const { appKey, appSecret } = getApiKeys(c.req.header())
  if (!appKey) return c.json({ error: 'API 키 필요' }, 401)
  const token = await getKisToken(c.env as any, appKey, appSecret)
  const data = await getDayCandles(token, appKey, appSecret, c.req.param('ticker'))
  return c.json(data)
})

// 거래량 순위
app.get('/api/stock/volume-rank', async (c) => {
  const { appKey, appSecret } = getApiKeys(c.req.header())
  if (!appKey) return c.json({ error: 'API 키 필요' }, 401)
  const token = await getKisToken(c.env as any, appKey, appSecret)
  const data = await getVolumeRank(token, appKey, appSecret)
  return c.json(data)
})

// 잔고 조회
app.get('/api/account/balance', async (c) => {
  const { appKey, appSecret, accountNo } = getApiKeys(c.req.header())
  if (!appKey || !accountNo) return c.json({ error: 'API 키 및 계좌번호 필요' }, 401)
  const token = await getKisToken(c.env as any, appKey, appSecret)
  const data = await getBalance(token, appKey, appSecret, accountNo)
  return c.json(data)
})

// 주문 실행 (Live)
app.post('/api/trade/order', async (c) => {
  const { appKey, appSecret, accountNo } = getApiKeys(c.req.header())
  if (!appKey || !accountNo) return c.json({ error: 'API 키 및 계좌번호 필요' }, 401)
  const body = await c.req.json()
  const token = await getKisToken(c.env as any, appKey, appSecret)
  const data = await placeOrder(token, appKey, appSecret, accountNo, body.ticker, body.qty, body.price, body.side, body.priceType || 'market')
  return c.json(data)
})

// 인메모리 폴백 스토어 (KV 없을 때)
const memStore: Record<string, any> = {}

async function kvGet(kv: KVNamespace | undefined, key: string) {
  if (kv) { try { return await kv.get(key, 'json') } catch { } }
  return memStore[key] ?? null
}

async function kvPut(kv: KVNamespace | undefined, key: string, value: any) {
  if (kv) { try { await kv.put(key, JSON.stringify(value)); return } catch { } }
  memStore[key] = value
}

// 전략 상태 저장 / 조회
app.get('/api/bot/state', async (c) => {
  const state = await kvGet(c.env.KV, 'bot_state')
  return c.json(state || getDefaultState())
})

app.post('/api/bot/state', async (c) => {
  const body = await c.req.json()
  await kvPut(c.env.KV, 'bot_state', body)
  return c.json({ ok: true })
})

// 거래 내역 조회
app.get('/api/trades', async (c) => {
  const trades = await kvGet(c.env.KV, 'trade_history')
  return c.json(trades || [])
})

app.post('/api/trades', async (c) => {
  const body = await c.req.json()
  const existing: any[] = (await kvGet(c.env.KV, 'trade_history')) || []
  existing.unshift(body)
  const trimmed = existing.slice(0, 500)
  await kvPut(c.env.KV, 'trade_history', trimmed)
  return c.json({ ok: true })
})

// 헬퍼: 헤더에서 API 키 추출
function getApiKeys(headers: Record<string, string | undefined>) {
  return {
    appKey: headers['x-app-key'] || '',
    appSecret: headers['x-app-secret'] || '',
    accountNo: headers['x-account-no'] || '',
  }
}

function getDefaultState() {
  return {
    running: false,
    mode: 'paper',
    strategy: 'scalping',
    positions: [],
    stats: {
      totalTrades: 0,
      winTrades: 0,
      totalProfit: 0,
      dailyProfit: 0,
    },
    config: {
      maxPositions: 3,
      positionSizeRatio: 0.3,
      profitTarget: 1.5,
      stopLoss: 1.0,
      scanInterval: 30,
      paperCapital: 5000000,
    },
  }
}

// ─────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📈 StockBot - 주식 자동매매</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen">

<!-- 헤더 -->
<header class="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
  <div class="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-2xl">📈</span>
      <span class="text-xl font-bold text-white">StockBot</span>
      <span class="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">한국투자증권 KIS API</span>
    </div>
    <div class="flex items-center gap-4">
      <div id="market-status" class="flex items-center gap-2 text-sm">
        <span class="w-2 h-2 rounded-full bg-gray-500" id="market-dot"></span>
        <span id="market-label" class="text-gray-400">장 상태 확인 중...</span>
      </div>
      <button onclick="openApiSettings()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition flex items-center gap-2">
        <i class="fas fa-key text-xs"></i> API 설정
      </button>
    </div>
  </div>
</header>

<!-- 메인 컨텐츠 -->
<main class="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">

  <!-- 통계 카드 -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="stat-card bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div class="text-gray-400 text-xs mb-1">총 자산</div>
      <div id="stat-total-asset" class="text-xl font-bold text-white">-</div>
      <div class="text-xs text-gray-500 mt-1">가용 현금 <span id="stat-cash" class="text-blue-400">-</span></div>
    </div>
    <div class="stat-card bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div class="text-gray-400 text-xs mb-1">오늘 손익</div>
      <div id="stat-daily-profit" class="text-xl font-bold text-white">-</div>
      <div class="text-xs text-gray-500 mt-1">수익률 <span id="stat-daily-rate" class="text-gray-400">-</span></div>
    </div>
    <div class="stat-card bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div class="text-gray-400 text-xs mb-1">누적 손익</div>
      <div id="stat-total-profit" class="text-xl font-bold text-white">-</div>
      <div class="text-xs text-gray-500 mt-1">승률 <span id="stat-win-rate" class="text-gray-400">-</span></div>
    </div>
    <div class="stat-card bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div class="text-gray-400 text-xs mb-1">포지션</div>
      <div id="stat-positions" class="text-xl font-bold text-white">0 / 3</div>
      <div class="text-xs text-gray-500 mt-1">총 거래 <span id="stat-trades" class="text-gray-400">0회</span></div>
    </div>
  </div>

  <!-- 봇 컨트롤 + 전략 설정 -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

    <!-- 봇 컨트롤 -->
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
      <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <i class="fas fa-robot text-blue-400"></i> 봇 컨트롤
      </h2>

      <!-- 모드 선택 -->
      <div>
        <label class="text-xs text-gray-400 mb-2 block">실행 모드</label>
        <div class="grid grid-cols-2 gap-2">
          <button id="mode-paper" onclick="setMode('paper')"
            class="mode-btn active-mode py-2 rounded text-sm font-medium transition">
            📄 페이퍼
          </button>
          <button id="mode-live" onclick="setMode('live')"
            class="mode-btn py-2 rounded text-sm font-medium transition">
            🔴 실전
          </button>
        </div>
      </div>

      <!-- 전략 선택 -->
      <div>
        <label class="text-xs text-gray-400 mb-2 block">매매 전략</label>
        <select id="strategy-select" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
          <option value="scalping">⚡ 스캘핑 (단기 변동성)</option>
          <option value="volume">📊 거래량 급증 포착</option>
          <option value="momentum">🚀 모멘텀 추종</option>
          <option value="mean_reversion">↩️ 평균 회귀</option>
        </select>
      </div>

      <!-- 시작/정지 버튼 -->
      <button id="bot-toggle-btn" onclick="toggleBot()"
        class="w-full py-3 rounded-lg text-base font-bold transition bg-green-600 hover:bg-green-700">
        <i class="fas fa-play mr-2"></i> 봇 시작
      </button>

      <!-- 봇 상태 -->
      <div id="bot-status-area" class="text-xs text-gray-500 space-y-1 pt-2 border-t border-gray-800">
        <div class="flex justify-between"><span>상태</span><span id="bot-running-label" class="text-gray-400">정지</span></div>
        <div class="flex justify-between"><span>스캔 주기</span><span id="bot-interval-label" class="text-blue-400">30초</span></div>
        <div class="flex justify-between"><span>다음 스캔</span><span id="next-scan-label" class="text-gray-400">-</span></div>
      </div>
    </div>

    <!-- 전략 파라미터 -->
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
      <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <i class="fas fa-sliders-h text-purple-400"></i> 전략 파라미터
      </h2>

      <div class="space-y-3">
        <div>
          <label class="text-xs text-gray-400 flex justify-between mb-1">
            <span>익절 목표 (%)</span><span id="profit-val" class="text-green-400">1.5%</span>
          </label>
          <input type="range" id="profit-target" min="0.5" max="5" step="0.1" value="1.5"
            oninput="updateSlider('profit-target','profit-val','%')"
            class="w-full accent-green-500">
        </div>
        <div>
          <label class="text-xs text-gray-400 flex justify-between mb-1">
            <span>손절 기준 (%)</span><span id="stoploss-val" class="text-red-400">1.0%</span>
          </label>
          <input type="range" id="stop-loss" min="0.3" max="3" step="0.1" value="1.0"
            oninput="updateSlider('stop-loss','stoploss-val','%')"
            class="w-full accent-red-500">
        </div>
        <div>
          <label class="text-xs text-gray-400 flex justify-between mb-1">
            <span>최대 포지션 수</span><span id="maxpos-val" class="text-blue-400">3개</span>
          </label>
          <input type="range" id="max-positions" min="1" max="10" step="1" value="3"
            oninput="updateSlider('max-positions','maxpos-val','개')"
            class="w-full accent-blue-500">
        </div>
        <div>
          <label class="text-xs text-gray-400 flex justify-between mb-1">
            <span>포지션 비율 (%)</span><span id="posratio-val" class="text-yellow-400">30%</span>
          </label>
          <input type="range" id="pos-ratio" min="5" max="50" step="5" value="30"
            oninput="updateSlider('pos-ratio','posratio-val','%')"
            class="w-full accent-yellow-500">
        </div>
        <div>
          <label class="text-xs text-gray-400 flex justify-between mb-1">
            <span>페이퍼 초기 자금</span><span id="paper-capital-val" class="text-gray-300">500만원</span>
          </label>
          <input type="range" id="paper-capital" min="1" max="50" step="1" value="5"
            oninput="updateCapitalSlider()"
            class="w-full accent-gray-400">
        </div>
      </div>

      <button onclick="saveConfig()" class="w-full py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm transition">
        <i class="fas fa-save mr-1"></i> 설정 저장
      </button>
    </div>

    <!-- 전략 진입 조건 표시 -->
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-3">
      <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <i class="fas fa-filter text-yellow-400"></i> 현재 진입 조건
      </h2>
      <div id="strategy-conditions" class="space-y-2 text-xs">
        <!-- 동적 렌더링 -->
      </div>
      <div class="pt-3 border-t border-gray-800">
        <div class="text-xs text-gray-500 mb-2">청산 조건</div>
        <div id="exit-conditions" class="space-y-1 text-xs"></div>
      </div>
      <div class="pt-2 border-t border-gray-800 text-xs text-gray-500">
        <div class="flex justify-between"><span>수수료 (매수+매도)</span><span class="text-gray-300">0.015% + 0.23%</span></div>
        <div class="flex justify-between mt-1"><span>실제 수익 계산</span><span class="text-gray-300">목표 - 0.245%</span></div>
      </div>
    </div>
  </div>

  <!-- 포지션 + 로그 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- 보유 포지션 -->
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <i class="fas fa-briefcase text-green-400"></i> 보유 포지션
        </h2>
        <button onclick="refreshPositions()" class="text-xs text-gray-500 hover:text-gray-300 transition">
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>
      <div id="positions-list" class="space-y-2 min-h-[120px]">
        <div class="text-gray-600 text-sm text-center py-8">포지션 없음</div>
      </div>
    </div>

    <!-- 실시간 로그 -->
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <i class="fas fa-terminal text-cyan-400"></i> 실시간 로그
        </h2>
        <button onclick="clearLog()" class="text-xs text-gray-500 hover:text-gray-300 transition">
          <i class="fas fa-trash"></i> 지우기
        </button>
      </div>
      <div id="log-area" class="bg-gray-950 rounded p-3 h-52 overflow-y-auto font-mono text-xs space-y-0.5"></div>
    </div>
  </div>

  <!-- 차트 + 거래내역 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- 수익 차트 -->
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <i class="fas fa-chart-line text-blue-400"></i> 누적 손익 추이
        </h2>
      </div>
      <canvas id="profit-chart" height="180"></canvas>
    </div>

    <!-- 거래 내역 -->
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <i class="fas fa-history text-orange-400"></i> 최근 거래 내역
        </h2>
        <button onclick="clearTrades()" class="text-xs text-gray-500 hover:text-gray-300">지우기</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-gray-500 border-b border-gray-800">
              <th class="pb-2 text-left">종목</th>
              <th class="pb-2 text-right">매수가</th>
              <th class="pb-2 text-right">매도가</th>
              <th class="pb-2 text-right">수익률</th>
              <th class="pb-2 text-right">결과</th>
            </tr>
          </thead>
          <tbody id="trades-tbody" class="divide-y divide-gray-800/50">
            <tr><td colspan="5" class="text-center text-gray-600 py-6">거래 내역 없음</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 종목 스캐너 -->
  <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <i class="fas fa-search text-pink-400"></i> 종목 스캐너
      </h2>
      <div class="flex gap-2">
        <input id="ticker-input" type="text" placeholder="종목코드 (예: 005930)" maxlength="6"
          class="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm w-40 focus:outline-none focus:border-blue-500">
        <button onclick="lookupStock()" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm transition">조회</button>
        <button onclick="loadVolumeRank()" class="px-3 py-1 bg-pink-700 hover:bg-pink-600 rounded text-sm transition">거래량 상위</button>
      </div>
    </div>
    <div id="scanner-result" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 min-h-[60px]">
      <div class="col-span-full text-gray-600 text-sm text-center py-4">종목을 검색하거나 거래량 상위를 불러오세요</div>
    </div>
  </div>

</main>

<!-- API 설정 모달 -->
<div id="api-modal" class="hidden fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
  <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-gray-700 space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-base font-bold flex items-center gap-2"><i class="fas fa-key text-yellow-400"></i> KIS API 설정</h3>
      <button onclick="closeApiSettings()" class="text-gray-500 hover:text-white"><i class="fas fa-times"></i></button>
    </div>

    <div class="bg-blue-950/50 border border-blue-800 rounded p-3 text-xs text-blue-300 space-y-1">
      <p><i class="fas fa-info-circle mr-1"></i> <strong>한국투자증권 KIS Developers</strong> API 키를 입력하세요.</p>
      <p>• <a href="https://apiportal.koreainvestment.com" target="_blank" class="underline">apiportal.koreainvestment.com</a> 에서 발급</p>
      <p>• 페이퍼 모드는 실전계좌 APP KEY로 모의투자 가능</p>
    </div>

    <div class="space-y-3">
      <div>
        <label class="text-xs text-gray-400 mb-1 block">APP KEY</label>
        <input id="input-app-key" type="password" placeholder="KIS APP KEY"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
      </div>
      <div>
        <label class="text-xs text-gray-400 mb-1 block">APP SECRET</label>
        <input id="input-app-secret" type="password" placeholder="KIS APP SECRET"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
      </div>
      <div>
        <label class="text-xs text-gray-400 mb-1 block">계좌번호 (실전 모드)</label>
        <input id="input-account-no" type="text" placeholder="예: 50012345-01"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
      </div>
    </div>

    <div class="flex gap-2">
      <button onclick="testApiConnection()" class="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition">
        <i class="fas fa-plug mr-1"></i> 연결 테스트
      </button>
      <button onclick="saveApiKeys()" class="flex-1 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition">
        <i class="fas fa-save mr-1"></i> 저장
      </button>
    </div>
    <div id="api-test-result" class="text-xs text-center text-gray-500"></div>
  </div>
</div>

<script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
