package com.autoprofit.bot.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface TradeRecordDao {

    @Query("SELECT * FROM trade_records ORDER BY timestampMs DESC")
    fun getAllFlow(): Flow<List<TradeRecordEntity>>

    @Query("SELECT * FROM trade_records ORDER BY timestampMs DESC LIMIT :limit")
    suspend fun getRecent(limit: Int = 200): List<TradeRecordEntity>

    @Query("SELECT * FROM trade_records WHERE timestampMs >= :sinceMs ORDER BY timestampMs DESC")
    suspend fun getSince(sinceMs: Long): List<TradeRecordEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(record: TradeRecordEntity)

    @Query("DELETE FROM trade_records WHERE timestampMs < :beforeMs")
    suspend fun deleteOlderThan(beforeMs: Long)

    @Query("SELECT COUNT(*) FROM trade_records WHERE action='BUY' AND timestampMs >= :sinceMs")
    suspend fun buyCountSince(sinceMs: Long): Int

    @Query("SELECT SUM(profitLossKrw) FROM trade_records WHERE action='SELL' AND timestampMs >= :sinceMs")
    suspend fun totalProfitSince(sinceMs: Long): Double?
}
