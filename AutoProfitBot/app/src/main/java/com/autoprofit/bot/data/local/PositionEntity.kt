package com.autoprofit.bot.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "positions")
data class PositionEntity(
    @PrimaryKey
    val ticker: String,
    val strategy: String,
    val avgBuyPrice: Double,
    val currentPrice: Double,
    val amount: Double,
    val investmentKrw: Double,
    val entryTimeMs: Long = System.currentTimeMillis(),
    val stopLossPrice: Double = 0.0,
    val takeProfitPrice: Double = 0.0,
    val trailingStopPrice: Double = 0.0,
    val orderUuid: String = ""
)
