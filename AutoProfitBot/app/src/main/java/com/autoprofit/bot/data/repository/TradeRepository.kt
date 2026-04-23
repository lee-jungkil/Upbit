package com.autoprofit.bot.data.repository

import com.autoprofit.bot.data.local.*
import com.autoprofit.bot.trading.models.Position
import com.autoprofit.bot.trading.models.TradeRecord
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TradeRepository @Inject constructor(
    private val tradeRecordDao: TradeRecordDao,
    private val positionDao: PositionDao
) {

    fun getAllTradesFlow(): Flow<List<TradeRecord>> =
        tradeRecordDao.getAllFlow().map { list -> list.map { it.toDomain() } }

    suspend fun getRecentTrades(limit: Int = 200): List<TradeRecord> =
        tradeRecordDao.getRecent(limit).map { it.toDomain() }

    suspend fun insertTrade(record: TradeRecord) {
        tradeRecordDao.insert(record.toEntity())
    }

    suspend fun deleteOldTrades(keepDays: Int = 30) {
        val cutoff = System.currentTimeMillis() - keepDays * 24 * 3600 * 1000L
        tradeRecordDao.deleteOlderThan(cutoff)
    }

    suspend fun todayProfit(): Double {
        val midnight = todayMidnightMs()
        return tradeRecordDao.totalProfitSince(midnight) ?: 0.0
    }

    suspend fun todayBuyCount(): Int {
        return tradeRecordDao.buyCountSince(todayMidnightMs())
    }

    fun getAllPositionsFlow(): Flow<List<Position>> =
        positionDao.getAllFlow().map { list -> list.map { it.toDomain() } }

    suspend fun getAllPositions(): List<Position> =
        positionDao.getAll().map { it.toDomain() }

    suspend fun savePosition(position: Position) {
        positionDao.insert(position.toEntity())
    }

    suspend fun deletePosition(ticker: String) {
        positionDao.delete(ticker)
    }

    suspend fun clearAllPositions() {
        positionDao.deleteAll()
    }

    private fun todayMidnightMs(): Long {
        val cal = java.util.Calendar.getInstance()
        cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
        cal.set(java.util.Calendar.MINUTE, 0)
        cal.set(java.util.Calendar.SECOND, 0)
        cal.set(java.util.Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
}

// ── Entity ↔ Domain 변환 ──────────────────────────────
private fun TradeRecordEntity.toDomain() = TradeRecord(
    id            = id,
    ticker        = ticker,
    action        = action,
    strategy      = strategy,
    price         = price,
    amount        = amount,
    investmentKrw = investmentKrw,
    profitLossKrw = profitLossKrw,
    profitLossPct = profitLossPct,
    reason        = reason,
    timestampMs   = timestampMs
)

private fun TradeRecord.toEntity() = TradeRecordEntity(
    id            = id,
    ticker        = ticker,
    action        = action,
    strategy      = strategy,
    price         = price,
    amount        = amount,
    investmentKrw = investmentKrw,
    profitLossKrw = profitLossKrw,
    profitLossPct = profitLossPct,
    reason        = reason,
    timestampMs   = timestampMs
)

private fun PositionEntity.toDomain() = Position(
    ticker             = ticker,
    strategy           = strategy,
    avgBuyPrice        = avgBuyPrice,
    currentPrice       = currentPrice,
    amount             = amount,
    investmentKrw      = investmentKrw,
    entryTimeMs        = entryTimeMs,
    stopLossPrice      = stopLossPrice,
    takeProfitPrice    = takeProfitPrice,
    trailingStopPrice  = trailingStopPrice,
    orderUuid          = orderUuid
)

private fun Position.toEntity() = PositionEntity(
    ticker             = ticker,
    strategy           = strategy,
    avgBuyPrice        = avgBuyPrice,
    currentPrice       = currentPrice,
    amount             = amount,
    investmentKrw      = investmentKrw,
    entryTimeMs        = entryTimeMs,
    stopLossPrice      = stopLossPrice,
    takeProfitPrice    = takeProfitPrice,
    trailingStopPrice  = trailingStopPrice,
    orderUuid          = orderUuid
)
