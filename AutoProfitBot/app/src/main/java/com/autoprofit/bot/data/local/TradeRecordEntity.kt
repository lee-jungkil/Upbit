package com.autoprofit.bot.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "trade_records")
data class TradeRecordEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val ticker: String,
    val action: String,          // "BUY" | "SELL"
    val strategy: String,
    val price: Double,
    val amount: Double,
    val investmentKrw: Double,
    val profitLossKrw: Double = 0.0,
    val profitLossPct: Double = 0.0,
    val reason: String = "",
    val timestampMs: Long = System.currentTimeMillis()
)
