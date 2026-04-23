package com.autoprofit.bot.trading.strategies

import com.autoprofit.bot.trading.models.Candle
import com.autoprofit.bot.trading.models.TechnicalIndicators
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * 기술적 지표 계산 엔진
 * Python main.py의 지표 계산 로직을 Kotlin으로 포팅
 */
object TechnicalIndicatorEngine {

    fun calculate(candles: List<Candle>): TechnicalIndicators? {
        if (candles.size < 60) return null
        val closes  = candles.map { it.close }
        val volumes = candles.map { it.volume }
        val highs   = candles.map { it.high }
        val lows    = candles.map { it.low }

        val rsi     = calculateRSI(closes, 14)
        val ema5    = calculateEMA(closes, 5)
        val ema20   = calculateEMA(closes, 20)
        val ema60   = calculateEMA(closes, 60)
        val macdResult = calculateMACD(closes)
        val bb      = calculateBollingerBands(closes, 20)
        val atr     = calculateATR(highs, lows, closes, 14)

        val currentVol = volumes.last()
        val avgVol     = volumes.takeLast(20).average()
        val volRatio   = if (avgVol > 0) currentVol / avgVol else 1.0

        val price1mAgo = if (candles.size >= 2) candles[candles.size - 2].close else closes.last()
        val price5mAgo = if (candles.size >= 6) candles[candles.size - 6].close else closes.last()
        val priceNow   = closes.last()
        val change1m   = ((priceNow - price1mAgo) / price1mAgo) * 100.0
        val change5m   = ((priceNow - price5mAgo) / price5mAgo) * 100.0

        return TechnicalIndicators(
            rsi              = rsi,
            macd             = macdResult.first,
            macdSignal       = macdResult.second,
            macdHistogram    = macdResult.third,
            ema5             = ema5,
            ema20            = ema20,
            ema60            = ema60,
            bollingerUpper   = bb.first,
            bollingerMiddle  = bb.second,
            bollingerLower   = bb.third,
            volume           = currentVol,
            volumeRatio      = volRatio,
            priceChange1m    = change1m,
            priceChange5m    = change5m,
            atr              = atr
        )
    }

    // ── RSI ──────────────────────────────────────────
    fun calculateRSI(closes: List<Double>, period: Int = 14): Double {
        if (closes.size <= period) return 50.0
        val changes = closes.zipWithNext { a, b -> b - a }
        val gains   = changes.map { if (it > 0) it else 0.0 }
        val losses  = changes.map { if (it < 0) -it else 0.0 }
        val recentGains  = gains.takeLast(period)
        val recentLosses = losses.takeLast(period)
        val avgGain = recentGains.average()
        val avgLoss = recentLosses.average()
        if (avgLoss == 0.0) return 100.0
        val rs = avgGain / avgLoss
        return 100.0 - (100.0 / (1.0 + rs))
    }

    // ── EMA ──────────────────────────────────────────
    fun calculateEMA(closes: List<Double>, period: Int): Double {
        if (closes.size < period) return closes.last()
        val multiplier = 2.0 / (period + 1)
        var ema = closes.take(period).average()
        for (i in period until closes.size) {
            ema = (closes[i] - ema) * multiplier + ema
        }
        return ema
    }

    // ── MACD ─────────────────────────────────────────
    fun calculateMACD(
        closes: List<Double>,
        fast: Int = 12, slow: Int = 26, signal: Int = 9
    ): Triple<Double, Double, Double> {
        if (closes.size < slow + signal) return Triple(0.0, 0.0, 0.0)
        val emaFast   = calculateEMA(closes, fast)
        val emaSlow   = calculateEMA(closes, slow)
        val macdLine  = emaFast - emaSlow
        // 최근 MACD 값 여러 개로 signal line 계산
        val macdHistory = mutableListOf<Double>()
        for (i in slow until closes.size) {
            val subFast = calculateEMA(closes.subList(0, i + 1), fast)
            val subSlow = calculateEMA(closes.subList(0, i + 1), slow)
            macdHistory.add(subFast - subSlow)
        }
        val signalLine = if (macdHistory.size >= signal)
            calculateEMA(macdHistory, signal) else macdLine
        return Triple(macdLine, signalLine, macdLine - signalLine)
    }

    // ── 볼린저 밴드 ───────────────────────────────────
    fun calculateBollingerBands(
        closes: List<Double>, period: Int = 20, stdDev: Double = 2.0
    ): Triple<Double, Double, Double> {
        if (closes.size < period) return Triple(closes.last(), closes.last(), closes.last())
        val recent = closes.takeLast(period)
        val middle = recent.average()
        val variance = recent.map { (it - middle) * (it - middle) }.average()
        val sd = Math.sqrt(variance)
        return Triple(middle + stdDev * sd, middle, middle - stdDev * sd)
    }

    // ── ATR ──────────────────────────────────────────
    fun calculateATR(
        highs: List<Double>, lows: List<Double>, closes: List<Double>, period: Int = 14
    ): Double {
        if (closes.size < period + 1) return 0.0
        val trueRanges = mutableListOf<Double>()
        for (i in 1 until closes.size) {
            val hl = highs[i] - lows[i]
            val hc = abs(highs[i] - closes[i - 1])
            val lc = abs(lows[i] - closes[i - 1])
            trueRanges.add(max(hl, max(hc, lc)))
        }
        return trueRanges.takeLast(period).average()
    }

    // ── 변동성 분류 ───────────────────────────────────
    fun classifyVolatility(candles: List<Candle>): String {
        val returns  = candles.takeLast(20).zipWithNext { a, b -> (b.close - a.close) / a.close * 100.0 }
        val stdDev   = returns.std()
        return when {
            stdDev > 2.0  -> "high"
            stdDev > 1.0  -> "medium"
            else          -> "low"
        }
    }

    // ── 추세 분류 ─────────────────────────────────────
    fun classifyTrend(candles: List<Candle>): String {
        if (candles.size < 20) return "neutral"
        val first = candles.takeLast(20).first().close
        val last  = candles.last().close
        val change = (last - first) / first * 100.0
        return when {
            change > 1.0  -> "up"
            change < -1.0 -> "down"
            else          -> "neutral"
        }
    }

    private fun List<Double>.std(): Double {
        val avg = average()
        return Math.sqrt(map { (it - avg) * (it - avg) }.average())
    }
}
