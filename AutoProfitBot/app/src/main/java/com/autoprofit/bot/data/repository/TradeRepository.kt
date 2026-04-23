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

    // ── 거래 기록 ──────────────────────────────────────
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
        val midnight = todayMidnightMs()
        return tradeRecordDao.buyCountSince(midnight)
    }

    // ── 포지션 ──────────────────────────────────────────
    fun getAllPositionsFlow(): Flow<List<Position>> =
        positionDao.getAllFlow().map { list -> list.map { it.toDomain() } }

    suspend fun getAllPositions(): List<Position> =
        positionDao.getAll().map { it.toDomain() }

    suspend fun savePosition(position: Position) {
        positionDao.insert(position.toEntity())
    }

    suspend fun deletePosition(market: String) {
        positionDao.delete(market)
    }

    suspend fun clearAllPositions() {
        positionDao.deleteAll()
    }

    // ── 헬퍼 ────────────────────────────────────────────
    private fun todayMidnightMs(): Long {
        val cal = java.util.Calendar.getInstance()
        cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
        cal.set(java.util.Calendar.MINUTE, 0)
        cal.set(java.util.Calendar.SECOND, 0)
        cal.set(java.util.Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
}

// ── 확장 함수 (Entity ↔ Domain) ─────────────────────────
private fun TradeRecordEntity.toDomain() = TradeRecord(
    id        = id,
    market    = market,
    side      = side,
    price     = price,
    volume    = volume,
    totalKrw  = totalKrw,
    profitKrw = profitKrw,
    profitPct = profitPct,
    reason    = reason,
    strategy  = strategy,
    timestamp = timestamp
)

private fun TradeRecord.toEntity() = TradeRecordEntity(
    id        = id,
    market    = market,
    side      = side,
    price     = price,
    volume    = volume,
    totalKrw  = totalKrw,
    profitKrw = profitKrw,
    profitPct = profitPct,
    reason    = reason,
    strategy  = strategy,
    timestamp = timestamp
)

private fun PositionEntity.toDomain() = Position(
    market       = market,
    buyPrice     = buyPrice,
    volume       = volume,
    totalKrw     = totalKrw,
    strategy     = strategy,
    buyTimestamp = buyTimestamp
)

private fun Position.toEntity() = PositionEntity(
    market       = market,
    buyPrice     = buyPrice,
    volume       = volume,
    totalKrw     = totalKrw,
    strategy     = strategy,
    buyTimestamp = buyTimestamp
)
