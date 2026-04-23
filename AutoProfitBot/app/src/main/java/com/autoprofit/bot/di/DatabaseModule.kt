package com.autoprofit.bot.di

import android.content.Context
import androidx.room.Room
import com.autoprofit.bot.data.local.*
import com.autoprofit.bot.data.repository.TradeRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "autoprofit_db"
        )
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    @Singleton
    fun provideTradeRecordDao(db: AppDatabase): TradeRecordDao = db.tradeRecordDao()

    @Provides
    @Singleton
    fun providePositionDao(db: AppDatabase): PositionDao = db.positionDao()

    @Provides
    @Singleton
    fun provideTradeRepository(
        tradeRecordDao: TradeRecordDao,
        positionDao: PositionDao
    ): TradeRepository = TradeRepository(tradeRecordDao, positionDao)
}
