package com.autoprofit.bot.service

import android.app.*
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.autoprofit.bot.AutoProfitApplication
import com.autoprofit.bot.MainActivity
import com.autoprofit.bot.R
import com.autoprofit.bot.api.UpbitRepository
import com.autoprofit.bot.trading.models.*
import com.autoprofit.bot.trading.strategies.*
import com.autoprofit.bot.utils.NotificationHelper
import com.autoprofit.bot.utils.SettingsManager
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import timber.log.Timber
import javax.inject.Inject

/**
 * 자동매매 백그라운드 포그라운드 서비스
 * - 앱이 꺼져도 24시간 거래 지속
 * - WakeLock으로 CPU 절전 방지
 * - 매수/매도/손익 알림 전송
 */
@AndroidEntryPoint
class TradingService : Service() {

    @Inject lateinit var repository: UpbitRepository
    @Inject lateinit var settingsManager: SettingsManager
    @Inject lateinit var notificationHelper: NotificationHelper

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var wakeLock: PowerManager.WakeLock? = null

    // 거래 엔진 상태
    private val strategies: Map<String, TradingStrategy> = StrategyFactory.createAll()
    private val positions  = mutableMapOf<String, Position>()
    private var botState   = BotState()
    private var isRunning  = false

    // 타이밍 설정
    private var lastFullScanTime    = 0L
    private var lastPositionCheckTime = 0L
    private val fullScanInterval    = 60_000L   // 1분 주기 전체 스캔
    private val positionCheckInterval = 5_000L  // 5초 주기 포지션 체크

    // 일일 통계
    private var dailyProfitKrw = 0.0
    private var todayWin = 0
    private var todayLoss = 0

    companion object {
        const val ACTION_START  = "ACTION_START"
        const val ACTION_STOP   = "ACTION_STOP"
        const val ACTION_PAUSE  = "ACTION_PAUSE"
        const val NOTIFICATION_ID = 1001

        // 브로드캐스트 이벤트 키
        const val BROADCAST_STATE   = "com.autoprofit.bot.STATE_UPDATE"
        const val EXTRA_BOT_STATE   = "bot_state_json"
    }

    override fun onCreate() {
        super.onCreate()
        Timber.d("TradingService 생성")
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startTrading()
            ACTION_STOP  -> stopTrading()
            ACTION_PAUSE -> pauseTrading()
        }
        return START_STICKY  // 시스템이 강제 종료해도 재시작
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        stopTrading()
        wakeLock?.release()
        Timber.d("TradingService 종료")
    }

    // ── 서비스 시작 ────────────────────────────────────

    private fun startTrading() {
        if (isRunning) return
        Timber.d("자동매매 시작")

        val settings = settingsManager.getSettings()
        repository.setApiKeys(settings.upbitAccessKey, settings.upbitSecretKey)

        // 포그라운드 알림 시작
        startForeground(NOTIFICATION_ID, buildForegroundNotification("자동매매 실행 중..."))

        isRunning = true
        updateBotStatus(BotStatus.RUNNING)

        serviceScope.launch {
            // 잔고 초기화
            initializeBalance(settings)
            // 메인 거래 루프
            tradingLoop(settings)
        }
    }

    private fun stopTrading() {
        isRunning = false
        serviceScope.coroutineContext.cancelChildren()
        updateBotStatus(BotStatus.STOPPED)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        Timber.d("자동매매 중지")
    }

    private fun pauseTrading() {
        isRunning = false
        updateBotStatus(BotStatus.PAUSED)
        Timber.d("자동매매 일시 정지")
    }

    // ── 메인 거래 루프 ─────────────────────────────────

    private suspend fun tradingLoop(settings: AppSettings) {
        while (isRunning) {
            val now = System.currentTimeMillis()

            try {
                // 1. 포지션 체크 (5초 주기) - 손익 청산 우선
                if (now - lastPositionCheckTime >= positionCheckInterval) {
                    checkAllPositions(settings)
                    lastPositionCheckTime = now
                }

                // 2. 전체 코인 스캔 (60초 주기) - 신규 진입
                if (now - lastFullScanTime >= fullScanInterval) {
                    scanAllCoins(settings)
                    lastFullScanTime = now
                }

                // 포그라운드 알림 업데이트
                updateForegroundNotification()

                delay(1_000L)  // 1초 대기

            } catch (e: CancellationException) {
                break
            } catch (e: Exception) {
                Timber.e(e, "거래 루프 오류")
                delay(5_000L)
            }
        }
    }

    // ── 전체 코인 스캔 ─────────────────────────────────

    private suspend fun scanAllCoins(settings: AppSettings) {
        if (positions.size >= settings.maxPositions) {
            Timber.d("최대 포지션 도달: ${positions.size}/${settings.maxPositions}")
            return
        }

        val coins = settings.enabledCoins
        val enabledStrategyNames = settings.selectedStrategies.toList()

        for (ticker in coins) {
            if (!isRunning) break
            if (positions.containsKey(ticker)) continue  // 이미 보유 중

            try {
                val strategyName = enabledStrategyNames.random()
                val strategy = strategies[strategyName] ?: continue
                analyzeTicker(ticker, strategy, settings)
                delay(200L)  // API 레이트 리밋
            } catch (e: Exception) {
                Timber.e(e, "코인 스캔 오류: $ticker")
            }
        }
    }

    // ── 티커 분석 및 매수 판단 ─────────────────────────

    private suspend fun analyzeTicker(
        ticker: String,
        strategy: TradingStrategy,
        settings: AppSettings
    ) {
        val candles = repository.getCandles(ticker, unit = 5, count = 200)
        if (candles.size < 60) return

        val signal = strategy.generateSignal(candles, ticker)

        if (signal.signal == TradingSignal.BUY && signal.confidence >= 60.0) {
            executeBuy(ticker, strategy, signal, settings)
        }
    }

    // ── 매수 실행 ──────────────────────────────────────

    private suspend fun executeBuy(
        ticker: String,
        strategy: TradingStrategy,
        signal: SignalResult,
        settings: AppSettings
    ) {
        // 리스크 체크: 일일 손실 한도
        if (dailyProfitKrw < -settings.maxDailyLoss) {
            Timber.w("일일 손실 한도 도달: ${dailyProfitKrw}원")
            return
        }

        // 포지션 비율 계산 (최대 20% 제한)
        val availableBalance = botState.availableBalance
        val positionSize = minOf(
            availableBalance * settings.maxPositionRatio,
            availableBalance / (settings.maxPositions - positions.size).coerceAtLeast(1)
        ).coerceIn(10_000.0, 500_000.0)  // 1만원 ~ 50만원

        if (positionSize < 5_000.0) {
            Timber.w("투자 금액 부족: ${positionSize}원")
            return
        }

        val currentPrice = repository.getCurrentPrice(ticker) ?: return

        // 매수 주문 실행
        val orderResult = if (settings.tradingMode == TradingMode.LIVE) {
            repository.placeBuyOrder(ticker, positionSize)
        } else {
            // 모의거래: 가상 주문 결과
            OrderResult(
                uuid           = java.util.UUID.randomUUID().toString(),
                side           = "bid",
                market         = ticker,
                price          = currentPrice,
                volume         = positionSize / currentPrice,
                executedVolume = positionSize / currentPrice,
                state          = "done",
                createdAt      = java.time.Instant.now().toString(),
                paidFee        = positionSize * 0.0005,
                success        = true
            )
        }

        if (orderResult?.success != true) {
            Timber.e("매수 주문 실패: $ticker")
            return
        }

        val amount = positionSize / currentPrice

        // 손절/익절가 계산
        val stopLossPrice    = currentPrice * (1.0 - strategy.config.stopLossPct / 100.0)
        val takeProfitPrice  = currentPrice * (1.0 + strategy.config.takeProfitPct / 100.0)

        val position = Position(
            ticker          = ticker,
            strategy        = strategy.config.name,
            avgBuyPrice     = currentPrice,
            currentPrice    = currentPrice,
            amount          = amount,
            investmentKrw   = positionSize,
            stopLossPrice   = stopLossPrice,
            takeProfitPrice = takeProfitPrice,
            orderUuid       = orderResult.uuid
        )

        positions[ticker] = position

        // 잔고 업데이트
        val newBalance = botState.availableBalance - positionSize
        botState = botState.copy(
            availableBalance = newBalance,
            totalInvested    = botState.totalInvested + positionSize,
            positions        = positions.values.toList()
        )

        Timber.d("✅ 매수 완료: $ticker @ ${String.format("%.0f", currentPrice)}원 / ${String.format("%.0f", positionSize)}원")

        // 매수 알림
        if (settings.notifyOnBuy) {
            notificationHelper.sendBuyNotification(
                TradeNotification(
                    type          = NotificationType.BUY,
                    ticker        = ticker,
                    price         = currentPrice,
                    amount        = amount,
                    investmentKrw = positionSize,
                    strategy      = strategy.config.displayName,
                    reason        = signal.reason
                )
            )
        }

        broadcastState()
    }

    // ── 포지션 체크 (손익 청산) ────────────────────────

    private suspend fun checkAllPositions(settings: AppSettings) {
        val positionList = positions.values.toList()

        for (position in positionList) {
            if (!isRunning) break
            try {
                checkPosition(position, settings)
                delay(100L)
            } catch (e: Exception) {
                Timber.e(e, "포지션 체크 오류: ${position.ticker}")
            }
        }

        // UI 상태 업데이트
        broadcastState()
    }

    private suspend fun checkPosition(position: Position, settings: AppSettings) {
        val currentPrice = repository.getCurrentPrice(position.ticker) ?: return
        val strategy     = strategies[position.strategy] ?: return

        // 현재가 업데이트
        positions[position.ticker] = position.copy(currentPrice = currentPrice)

        val profitRatio = ((currentPrice - position.avgBuyPrice) / position.avgBuyPrice) * 100.0
        val holdMinutes = (System.currentTimeMillis() - position.entryTimeMs) / 60_000L

        // 트레일링 스탑 업데이트
        if (profitRatio > 1.0) {
            val newTrailingStop = currentPrice * 0.99  // 현재가 -1% 추적
            if (newTrailingStop > position.trailingStopPrice) {
                positions[position.ticker] = positions[position.ticker]!!
                    .copy(trailingStopPrice = newTrailingStop)
            }
        }

        val pos = positions[position.ticker]!!
        var sellReason: String? = null
        var notifType = NotificationType.SELL_PROFIT

        // ── 청산 조건 체크 (우선순위 순) ──────────────

        // 1. 손절 (Stop Loss)
        if (currentPrice <= position.stopLossPrice) {
            sellReason = "손절(${String.format("%.2f", profitRatio)}%)"
            notifType  = NotificationType.STOP_LOSS
        }
        // 2. 익절 (Take Profit)
        else if (currentPrice >= position.takeProfitPrice) {
            sellReason = "익절(+${String.format("%.2f", profitRatio)}%)"
            notifType  = NotificationType.TAKE_PROFIT
        }
        // 3. 트레일링 스탑 (수익 실현 후)
        else if (pos.trailingStopPrice > 0 && currentPrice < pos.trailingStopPrice) {
            sellReason = "트레일링 스탑(${String.format("%.2f", profitRatio)}%)"
            notifType  = if (profitRatio > 0) NotificationType.SELL_PROFIT else NotificationType.SELL_LOSS
        }
        // 4. 최대 보유 시간 초과
        else if (holdMinutes >= strategy.config.maxHoldMinutes) {
            sellReason = "시간초과(${holdMinutes}분, ${String.format("%.2f", profitRatio)}%)"
            notifType  = if (profitRatio > 0) NotificationType.SELL_PROFIT else NotificationType.SELL_LOSS
        }
        // 5. 차트 신호 (매도 신호)
        else {
            val candles = repository.getCandles(position.ticker, unit = 5, count = 60)
            if (candles.size >= 30) {
                val signal = strategy.generateSignal(candles, position.ticker)
                if (signal.signal == TradingSignal.SELL) {
                    sellReason = "차트 매도 신호: ${signal.reason}"
                    notifType  = if (profitRatio > 0) NotificationType.SELL_PROFIT else NotificationType.SELL_LOSS
                }
            }
        }

        // 매도 실행
        if (sellReason != null) {
            executeSell(pos, currentPrice, sellReason, notifType, settings)
        }
    }

    // ── 매도 실행 ──────────────────────────────────────

    private suspend fun executeSell(
        position: Position,
        currentPrice: Double,
        reason: String,
        notifType: NotificationType,
        settings: AppSettings
    ) {
        val profitKrw  = (currentPrice - position.avgBuyPrice) * position.amount
        val profitPct  = ((currentPrice - position.avgBuyPrice) / position.avgBuyPrice) * 100.0

        val orderResult = if (settings.tradingMode == TradingMode.LIVE) {
            repository.placeSellOrder(position.ticker, position.amount)
        } else {
            OrderResult(
                uuid           = java.util.UUID.randomUUID().toString(),
                side           = "ask",
                market         = position.ticker,
                price          = currentPrice,
                volume         = position.amount,
                executedVolume = position.amount,
                state          = "done",
                createdAt      = java.time.Instant.now().toString(),
                paidFee        = position.investmentKrw * 0.0005,
                success        = true
            )
        }

        if (orderResult?.success != true) {
            Timber.e("매도 주문 실패: ${position.ticker}")
            return
        }

        // 포지션 제거
        positions.remove(position.ticker)

        // 통계 업데이트
        dailyProfitKrw += profitKrw
        if (profitKrw > 0) todayWin++ else todayLoss++

        val sellAmount = currentPrice * position.amount
        val newBalance = botState.availableBalance + sellAmount

        botState = botState.copy(
            availableBalance  = newBalance,
            totalInvested     = (botState.totalInvested - position.investmentKrw).coerceAtLeast(0.0),
            dailyProfitKrw    = dailyProfitKrw,
            todayTradeCount   = todayWin + todayLoss,
            winCount          = todayWin,
            lossCount         = todayLoss,
            positions         = positions.values.toList()
        )

        val emoji = if (profitKrw > 0) "💰" else "💸"
        Timber.d("$emoji 매도 완료: ${position.ticker} @ ${String.format("%.0f", currentPrice)}원 | 손익: ${String.format("%+.0f", profitKrw)}원 (${String.format("%+.2f", profitPct)}%) | 사유: $reason")

        // 매도 알림
        val shouldNotify = when (notifType) {
            NotificationType.STOP_LOSS  -> settings.notifyOnStopLoss
            else                        -> settings.notifyOnSell
        }
        if (shouldNotify) {
            notificationHelper.sendSellNotification(
                TradeNotification(
                    type          = notifType,
                    ticker        = position.ticker,
                    price         = currentPrice,
                    amount        = position.amount,
                    investmentKrw = position.investmentKrw,
                    profitLossKrw = profitKrw,
                    profitLossPct = profitPct,
                    strategy      = position.strategy,
                    reason        = reason
                )
            )
        }

        broadcastState()
    }

    // ── 잔고 초기화 ────────────────────────────────────

    private suspend fun initializeBalance(settings: AppSettings) {
        val balance = when (settings.tradingMode) {
            TradingMode.LIVE -> repository.getKrwBalance()
            else             -> settings.initialCapital
        }
        botState = botState.copy(
            totalBalance     = balance,
            availableBalance = balance,
            mode             = settings.tradingMode,
            status           = BotStatus.RUNNING
        )
        Timber.d("잔고 초기화: ${String.format("%.0f", balance)}원")
        broadcastState()
    }

    // ── 포그라운드 알림 ────────────────────────────────

    private fun buildForegroundNotification(content: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this, 0,
            Intent(this, TradingService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, AutoProfitApplication.CHANNEL_TRADING_SERVICE)
            .setContentTitle("🤖 AutoProfitBot")
            .setContentText(content)
            .setSmallIcon(R.drawable.ic_bot_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .addAction(R.drawable.ic_stop, "중지", stopIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateForegroundNotification() {
        val profit = botState.dailyProfitKrw
        val emoji  = if (profit >= 0) "📈" else "📉"
        val content = "$emoji 오늘 손익: ${String.format("%+,.0f", profit)}원 | 포지션: ${positions.size}개"
        val notification = buildForegroundNotification(content)
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    // ── 상태 브로드캐스트 ──────────────────────────────

    private fun broadcastState() {
        val intent = Intent(BROADCAST_STATE).apply {
            // 실제로는 gson으로 직렬화하거나 LiveData/Flow를 사용
            putExtra("positions_count", positions.size)
            putExtra("daily_profit",    botState.dailyProfitKrw)
            putExtra("balance",         botState.availableBalance)
            putExtra("status",          botState.status.name)
        }
        sendBroadcast(intent)
    }

    private fun updateBotStatus(status: BotStatus) {
        botState = botState.copy(status = status)
        broadcastState()
    }

    // ── WakeLock ───────────────────────────────────────

    private fun acquireWakeLock() {
        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AutoProfitBot::TradingWakeLock"
        ).apply { acquire(24 * 60 * 60 * 1000L)  /* 최대 24시간 */ }
    }
}
