package com.autoprofit.bot.trading.strategies

import com.autoprofit.bot.trading.models.*

/**
 * 거래 전략 모음
 * Python main.py의 5가지 전략을 Kotlin으로 포팅
 */

// =============================================
// 전략 기본 인터페이스
// =============================================
interface TradingStrategy {
    val config: StrategyConfig
    fun generateSignal(candles: List<Candle>, ticker: String): SignalResult
}

// =============================================
// 1. 공격적 스캘핑 (AggressiveScalping)
//    익절: +1.5% / 손절: -1.0% / 최대 보유: 4분
// =============================================
class AggressiveScalpingStrategy : TradingStrategy {

    override val config = StrategyConfig(
        name           = "aggressive_scalping",
        displayName    = "공격적 스캘핑",
        takeProfitPct  = 1.5,
        stopLossPct    = 1.0,
        maxHoldMinutes = 4
    )

    override fun generateSignal(candles: List<Candle>, ticker: String): SignalResult {
        val indicators = TechnicalIndicatorEngine.calculate(candles)
            ?: return SignalResult(TradingSignal.HOLD, "데이터 부족")

        val price = candles.last().close
        val reasons = mutableListOf<String>()
        var buyScore = 0

        // RSI 과매도 확인 (30 이하)
        if (indicators.rsi < 30) {
            buyScore += 2
            reasons.add("RSI 과매도(${String.format("%.1f", indicators.rsi)})")
        } else if (indicators.rsi < 40) {
            buyScore += 1
            reasons.add("RSI 낮음(${String.format("%.1f", indicators.rsi)})")
        }

        // MACD 골든크로스
        if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
            buyScore += 2
            reasons.add("MACD 골든크로스")
        }

        // 볼린저 밴드 하단 돌파 (반등 기대)
        if (price <= indicators.bollingerLower * 1.01) {
            buyScore += 2
            reasons.add("볼린저 하단")
        }

        // EMA 단기 > 장기 (상승 추세)
        if (indicators.ema5 > indicators.ema20) {
            buyScore += 1
            reasons.add("EMA 상승")
        }

        // 거래량 증가
        if (indicators.volumeRatio > 1.5) {
            buyScore += 1
            reasons.add("거래량 ${String.format("%.1f", indicators.volumeRatio)}x")
        }

        // 1분 가격 변화 상승
        if (indicators.priceChange1m in 0.1..1.5) {
            buyScore += 1
            reasons.add("단기 상승")
        }

        val confidence = (buyScore / 9.0) * 100.0

        return when {
            buyScore >= 5 -> SignalResult(
                TradingSignal.BUY, reasons.joinToString(" + "),
                confidence, indicators.toMap()
            )
            // 급락 시 매도
            indicators.priceChange1m < -1.5 -> SignalResult(
                TradingSignal.SELL, "1분 급락(${String.format("%.2f", indicators.priceChange1m)}%)",
                90.0, indicators.toMap()
            )
            else -> SignalResult(TradingSignal.HOLD, "조건 미충족(점수:$buyScore)")
        }
    }
}

// =============================================
// 2. 보수적 스캘핑 (ConservativeScalping)
//    익절: +2.0% / 손절: -1.5% / 최대 보유: 8분
// =============================================
class ConservativeScalpingStrategy : TradingStrategy {

    override val config = StrategyConfig(
        name           = "conservative_scalping",
        displayName    = "보수적 스캘핑",
        takeProfitPct  = 2.0,
        stopLossPct    = 1.5,
        maxHoldMinutes = 8
    )

    override fun generateSignal(candles: List<Candle>, ticker: String): SignalResult {
        val indicators = TechnicalIndicatorEngine.calculate(candles)
            ?: return SignalResult(TradingSignal.HOLD, "데이터 부족")

        val price = candles.last().close
        var buyScore = 0
        val reasons = mutableListOf<String>()

        // 엄격한 RSI 조건 (25 이하)
        if (indicators.rsi < 25) {
            buyScore += 3
            reasons.add("RSI 강한 과매도(${String.format("%.1f", indicators.rsi)})")
        } else if (indicators.rsi < 35) {
            buyScore += 1
            reasons.add("RSI 과매도(${String.format("%.1f", indicators.rsi)})")
        }

        // MACD 히스토그램 상승 전환
        if (indicators.macdHistogram > 0) {
            buyScore += 2
            reasons.add("MACD 양전환")
        }

        // 볼린저 밴드 하단 + 거래량 확인
        if (price < indicators.bollingerLower && indicators.volumeRatio > 1.2) {
            buyScore += 3
            reasons.add("볼린저 하단+거래량")
        }

        // EMA 정배열 (5 > 20 > 60)
        if (indicators.ema5 > indicators.ema20 && indicators.ema20 > indicators.ema60) {
            buyScore += 2
            reasons.add("EMA 정배열")
        }

        val confidence = (buyScore / 10.0) * 100.0

        return when {
            buyScore >= 6 -> SignalResult(
                TradingSignal.BUY, reasons.joinToString(" + "),
                confidence, indicators.toMap()
            )
            indicators.rsi > 75 -> SignalResult(
                TradingSignal.SELL, "RSI 과매수(${String.format("%.1f", indicators.rsi)})",
                80.0, indicators.toMap()
            )
            else -> SignalResult(TradingSignal.HOLD, "조건 미충족(점수:$buyScore)")
        }
    }
}

// =============================================
// 3. 평균 회귀 (MeanReversion)
//    익절: +3.0% / 손절: -2.0% / 최대 보유: 30분
// =============================================
class MeanReversionStrategy : TradingStrategy {

    override val config = StrategyConfig(
        name           = "mean_reversion",
        displayName    = "평균 회귀",
        takeProfitPct  = 3.0,
        stopLossPct    = 2.0,
        maxHoldMinutes = 30,
        rsiOversold    = 35.0,
        rsiOverbought  = 65.0
    )

    override fun generateSignal(candles: List<Candle>, ticker: String): SignalResult {
        val indicators = TechnicalIndicatorEngine.calculate(candles)
            ?: return SignalResult(TradingSignal.HOLD, "데이터 부족")

        val price = candles.last().close

        // 과매도 + 볼린저 하단 = 반등 매수
        val isBuyCondition =
            indicators.rsi < config.rsiOversold &&
            price < indicators.bollingerLower &&
            indicators.macdHistogram > -0.001

        // 과매수 + 볼린저 상단 = 매도
        val isSellCondition =
            indicators.rsi > config.rsiOverbought &&
            price > indicators.bollingerUpper

        return when {
            isBuyCondition -> SignalResult(
                TradingSignal.BUY,
                "평균 회귀 매수(RSI:${String.format("%.1f", indicators.rsi)}, 볼린저 하단)",
                75.0, indicators.toMap()
            )
            isSellCondition -> SignalResult(
                TradingSignal.SELL,
                "평균 회귀 매도(RSI:${String.format("%.1f", indicators.rsi)}, 볼린저 상단)",
                75.0, indicators.toMap()
            )
            else -> SignalResult(TradingSignal.HOLD, "조건 미충족")
        }
    }
}

// =============================================
// 4. 그리드 트레이딩 (GridTrading)
//    익절: +5.0% / 손절: -3.0% / 최대 보유: 60분
// =============================================
class GridTradingStrategy : TradingStrategy {

    override val config = StrategyConfig(
        name           = "grid_trading",
        displayName    = "그리드 트레이딩",
        takeProfitPct  = 5.0,
        stopLossPct    = 3.0,
        maxHoldMinutes = 60
    )

    override fun generateSignal(candles: List<Candle>, ticker: String): SignalResult {
        val indicators = TechnicalIndicatorEngine.calculate(candles)
            ?: return SignalResult(TradingSignal.HOLD, "데이터 부족")

        val price  = candles.last().close
        val bb     = Triple(indicators.bollingerUpper, indicators.bollingerMiddle, indicators.bollingerLower)
        val bbRange = bb.first - bb.third

        // 그리드 레벨 계산 (볼린저 밴드 기준 4등분)
        val gridLevel = when {
            price < bb.third + bbRange * 0.25 -> 1  // 최하단
            price < bb.second                  -> 2  // 하단
            price < bb.first - bbRange * 0.25  -> 3  // 상단
            else                               -> 4  // 최상단
        }

        return when (gridLevel) {
            1 -> SignalResult(
                TradingSignal.BUY,
                "그리드 최하단 매수(레벨1)",
                85.0, indicators.toMap()
            )
            2 -> if (indicators.rsi < 45) SignalResult(
                TradingSignal.BUY, "그리드 하단 매수(레벨2)",
                65.0, indicators.toMap()
            ) else SignalResult(TradingSignal.HOLD, "그리드 대기")
            4 -> SignalResult(
                TradingSignal.SELL, "그리드 최상단 매도(레벨4)",
                85.0, indicators.toMap()
            )
            else -> SignalResult(TradingSignal.HOLD, "그리드 중간 대기(레벨$gridLevel)")
        }
    }
}

// =============================================
// 5. 초단타 스캘핑 (UltraScalping)
//    익절: +0.8% / 손절: -0.5% / 최대 보유: 3분
// =============================================
class UltraScalpingStrategy : TradingStrategy {

    override val config = StrategyConfig(
        name           = "ultra_scalping",
        displayName    = "초단타 스캘핑",
        takeProfitPct  = 0.8,
        stopLossPct    = 0.5,
        maxHoldMinutes = 3,
        minVolume      = 2.0
    )

    override fun generateSignal(candles: List<Candle>, ticker: String): SignalResult {
        val indicators = TechnicalIndicatorEngine.calculate(candles)
            ?: return SignalResult(TradingSignal.HOLD, "데이터 부족")

        // 초단타: 거래량 + 모멘텀 중심
        val isStrongBuy =
            indicators.volumeRatio > config.minVolume &&
            indicators.priceChange1m > 0.1 &&
            indicators.rsi in 35.0..65.0 &&
            indicators.macdHistogram > 0

        return when {
            isStrongBuy -> SignalResult(
                TradingSignal.BUY,
                "초단타 매수(거래량:${String.format("%.1f", indicators.volumeRatio)}x, 1m:+${String.format("%.2f", indicators.priceChange1m)}%)",
                (indicators.volumeRatio / 4.0 * 100.0).coerceAtMost(95.0),
                indicators.toMap()
            )
            indicators.priceChange1m < -0.5 -> SignalResult(
                TradingSignal.SELL, "초단타 급락(${String.format("%.2f", indicators.priceChange1m)}%)",
                90.0, indicators.toMap()
            )
            else -> SignalResult(TradingSignal.HOLD, "모멘텀 없음")
        }
    }
}

// =============================================
// 전략 팩토리
// =============================================
object StrategyFactory {
    fun createAll(): Map<String, TradingStrategy> = mapOf(
        "aggressive_scalping"   to AggressiveScalpingStrategy(),
        "conservative_scalping" to ConservativeScalpingStrategy(),
        "mean_reversion"        to MeanReversionStrategy(),
        "grid_trading"          to GridTradingStrategy(),
        "ultra_scalping"        to UltraScalpingStrategy()
    )

    fun getConfig(strategyName: String): StrategyConfig? =
        createAll()[strategyName]?.config

    fun getAllConfigs(): List<StrategyConfig> =
        createAll().values.map { it.config }
}

// =============================================
// 확장 함수
// =============================================
fun TechnicalIndicators.toMap(): Map<String, Double> = mapOf(
    "rsi"             to rsi,
    "macd"            to macd,
    "macd_signal"     to macdSignal,
    "macd_histogram"  to macdHistogram,
    "ema5"            to ema5,
    "ema20"           to ema20,
    "ema60"           to ema60,
    "bb_upper"        to bollingerUpper,
    "bb_middle"       to bollingerMiddle,
    "bb_lower"        to bollingerLower,
    "volume_ratio"    to volumeRatio,
    "price_change_1m" to priceChange1m,
    "price_change_5m" to priceChange5m,
    "atr"             to atr
)
