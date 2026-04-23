package com.autoprofit.bot.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface PositionDao {

    @Query("SELECT * FROM positions")
    fun getAllFlow(): Flow<List<PositionEntity>>

    @Query("SELECT * FROM positions")
    suspend fun getAll(): List<PositionEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(position: PositionEntity)

    @Query("DELETE FROM positions WHERE ticker = :ticker")
    suspend fun delete(ticker: String)

    @Query("DELETE FROM positions")
    suspend fun deleteAll()
}
