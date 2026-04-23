package com.autoprofit.bot.trading.models

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

// =============================================
// 캔들 데이터
// =============================================
data class Candle(
    val market: String,
    val timestamp: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val dateTimeKst: String = ""
)

// =============================================
// 호가창 데이터
// =============================================
data class OrderbookData(
    val market: String,
    val totalAskSize: Double,
    val totalBidSize: Double,
    val units: List<OrderbookUnit>
) {
    // 매수/매도 비율 (> 1이면 매수세 강함)
    val bidAskRatio: Double get() = if (totalAskSize > 0) totalBidSize / totalAskSize else 1.0
}

data class OrderbookUnit(
    val askPrice: Double,
    val bidPrice: Double,
    val askSize: Double,
    val bidSize: Double
)

// =============================================
// 체결 데이터
// =============================================
data class TradeData(
    val market: String,
    val price: Double,
    val volume: Double,
    val askBid: String,     // "ASK"=매도, "BID"=매수
    val timestamp: Long
)

// =============================================
// 계좌 정보
// =============================================
data class AccountInfo(
    val currency: String,
    val balance: Double,
    val locked: Double,
    val avgBuyPrice: Double,
    val unitCurrency: String
) {
    val totalBalance: Double get() = balance + locked
}

// =============================================
// 주문 결과
// =============================================
data class OrderResult(
    val uuid: String,
    val side: String,
    val market: String,
    val price: Double?,
    val volume: Double?,
    val executedVolume: Double?,
    val state: String,
    val createdAt: String,
    val paidFee: Double?,
    val success: Boolean,
    val errorMessage: String? = null
)

// =============================================
// 포지션 (보유 코인)
// =============================================
@Parcelize
data class Position(
    val ticker: String,
    val strategy: String,
    val avgBuyPrice: Double,
    var currentPrice: Double,
    val amount: Double,
    val investmentKrw: Double,
    val entryTimeMs: Long = System.currentTimeMillis(),
    var stopLossPrice: Double = 0.0,
    var takeProfitPrice: Double = 0.0,
    var trailingStopPrice: Double = 0.0,
    var orderUuid: String = ""
) : Parcelable {

    val currentValueKrw: Double get() = currentPrice * amount
    val profitLossKrw: Double   get() = currentValueKrw - investmentKrw
    val profitLossRatio: Double get() = if (investmentKrw > 0) (profitLossKrw / investmentKrw) * 100.0 else 0.0
    val holdingMinutes: Long    get() = (System.currentTimeMillis() - entryTimeMs) / 60000L
    val coinName: String        get() = ticker.substringAfter("-")
    val isProfit: Boolean       get() = profitLossKrw >= 0
}

// =============================================
// 트레이딩 신호
// =============================================
enum class TradingSignal { BUY, SELL, HOLD }

data class SignalResult(
    val signal: TradingSignal,
    val reason: String,
    val confidence: Double = 0.0,
    val indicators: Map<String, Double> = emptyMap()
)

// =============================================
// 전략 설정
// =============================================
data class StrategyConfig(
    val name: String,
    val displayName: String,
    val takeProfitPct: Double,
    val stopLossPct: Double,
    val maxHoldMinutes: Int,
    val minVolume: Double = 0.0,
    val rsiOversold: Double = 30.0,
    val rsiOverbought: Double = 70.0,
    val enabled: Boolean = true
)

// =============================================
// 거래 기록
// =============================================
data class TradeRecord(
    val id: Long = 0,
    val ticker: String,
    val action: String,          // BUY / SELL
    val strategy: String,
    val price: Double,
    val amount: Double,
    val investmentKrw: Double,
    val profitLossKrw: Double = 0.0,
    val profitLossPct: Double = 0.0,
    val reason: String = "",
    val timestampMs: Long = System.currentTimeMillis()
)

// =============================================
// 봇 상태
// =============================================
enum class BotStatus {
    STOPPED,
    RUNNING,
    PAUSED,
    ERROR
}

data class BotState(
    val status: BotStatus = BotStatus.STOPPED,
    val mode: TradingMode = TradingMode.PAPER,
    val totalBalance: Double = 0.0,
    val availableBalance: Double = 0.0,
    val totalInvested: Double = 0.0,
    val totalProfitLossKrw: Double = 0.0,
    val totalProfitLossPct: Double = 0.0,
    val dailyProfitKrw: Double = 0.0,
    val todayTradeCount: Int = 0,
    val winCount: Int = 0,
    val lossCount: Int = 0,
    val positions: List<Position> = emptyList(),
    val lastUpdateMs: Long = System.currentTimeMillis(),
    val errorMessage: String? = null
) {
    val winRate: Double get() = if ((winCount + lossCount) > 0) winCount.toDouble() / (winCount + lossCount) * 100.0 else 0.0
    val totalTradeCount: Int get() = winCount + lossCount
}

enum class TradingMode(val displayName: String) {
    PAPER("모의거래"),
    LIVE("실전거래"),
    BACKTEST("백테스트")
}

// =============================================
// 알림 데이터
// =============================================
data class TradeNotification(
    val type: NotificationType,
    val ticker: String,
    val price: Double,
    val amount: Double,
    val investmentKrw: Double,
    val profitLossKrw: Double = 0.0,
    val profitLossPct: Double = 0.0,
    val strategy: String = "",
    val reason: String = "",
    val timestampMs: Long = System.currentTimeMillis()
)

enum class NotificationType {
    BUY,
    SELL_PROFIT,
    SELL_LOSS,
    STOP_LOSS,
    TAKE_PROFIT,
    DAILY_SUMMARY,
    WARNING,
    ERROR
}

// =============================================
// 기술 지표
// =============================================
data class TechnicalIndicators(
    val rsi: Double,
    val macd: Double,
    val macdSignal: Double,
    val macdHistogram: Double,
    val ema5: Double,
    val ema20: Double,
    val ema60: Double,
    val bollingerUpper: Double,
    val bollingerMiddle: Double,
    val bollingerLower: Double,
    val volume: Double,
    val volumeRatio: Double,   // 현재 거래량 / 평균 거래량
    val priceChange1m: Double, // 1분 수익률
    val priceChange5m: Double, // 5분 수익률
    val atr: Double = 0.0
)

// =============================================
// 앱 설정
// =============================================
data class AppSettings(
    val tradingMode: TradingMode = TradingMode.PAPER,
    val upbitAccessKey: String = "",
    val upbitSecretKey: String = "",
    val initialCapital: Double = 1_000_000.0,
    val maxDailyLoss: Double = 100_000.0,
    val maxPositions: Int = 5,
    val maxPositionRatio: Double = 0.2,
    val selectedStrategies: Set<String> = setOf("aggressive_scalping", "conservative_scalping"),
    val enabledCoins: List<String> = DEFAULT_COINS,
    val notifyOnBuy: Boolean = true,
    val notifyOnSell: Boolean = true,
    val notifyOnStopLoss: Boolean = true,
    val notifyOnDailySummary: Boolean = true,
    val autoStartOnBoot: Boolean = false,
    val exitMode: String = "aggressive"
) {
    companion object {
        val DEFAULT_COINS = listOf(
            "KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-ADA",
            "KRW-SOL", "KRW-DOGE", "KRW-DOT", "KRW-AVAX",
            "KRW-MATIC", "KRW-LINK", "KRW-UNI", "KRW-ATOM"
        )
    }
}
