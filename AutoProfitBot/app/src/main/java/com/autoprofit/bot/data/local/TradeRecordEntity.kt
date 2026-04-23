package com.autoprofit.bot.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "trade_records")
data class TradeRecordEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val market: String,
    val side: String,          // "BUY" | "SELL"
    val price: Double,
    val volume: Double,
    val totalKrw: Double,
    val profitKrw: Double,
    val profitPct: Double,
    val reason: String,
    val strategy: String,
    val timestamp: Long = System.currentTimeMillis()
)
