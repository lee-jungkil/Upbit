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

    @Query("DELETE FROM positions WHERE market = :market")
    suspend fun delete(market: String)

    @Query("DELETE FROM positions")
    suspend fun deleteAll()
}
