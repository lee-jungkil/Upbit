package com.autoprofit.bot.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface TradeRecordDao {

    @Query("SELECT * FROM trade_records ORDER BY timestamp DESC")
    fun getAllFlow(): Flow<List<TradeRecordEntity>>

    @Query("SELECT * FROM trade_records ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecent(limit: Int = 200): List<TradeRecordEntity>

    @Query("SELECT * FROM trade_records WHERE timestamp >= :sinceMs ORDER BY timestamp DESC")
    suspend fun getSince(sinceMs: Long): List<TradeRecordEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(record: TradeRecordEntity)

    @Query("DELETE FROM trade_records WHERE timestamp < :beforeMs")
    suspend fun deleteOlderThan(beforeMs: Long)

    @Query("SELECT COUNT(*) FROM trade_records WHERE side='BUY' AND timestamp >= :sinceMs")
    suspend fun buyCountSince(sinceMs: Long): Int

    @Query("SELECT SUM(profitKrw) FROM trade_records WHERE side='SELL' AND timestamp >= :sinceMs")
    suspend fun totalProfitSince(sinceMs: Long): Double?
}
