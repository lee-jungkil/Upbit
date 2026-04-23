package com.autoprofit.bot.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "positions")
data class PositionEntity(
    @PrimaryKey
    val market: String,
    val buyPrice: Double,
    val volume: Double,
    val totalKrw: Double,
    val strategy: String,
    val buyTimestamp: Long = System.currentTimeMillis()
)
