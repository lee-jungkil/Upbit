package com.autoprofit.bot.di

import android.content.Context
import com.autoprofit.bot.api.UpbitApiService
import com.autoprofit.bot.api.UpbitAuthManager
import com.autoprofit.bot.api.UpbitRepository
import com.autoprofit.bot.utils.NotificationHelper
import com.autoprofit.bot.utils.SettingsManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    private const val UPBIT_BASE_URL = "https://api.upbit.com/"

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(UPBIT_BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

    @Provides
    @Singleton
    fun provideUpbitApiService(retrofit: Retrofit): UpbitApiService =
        retrofit.create(UpbitApiService::class.java)

    @Provides
    @Singleton
    fun provideUpbitAuthManager(): UpbitAuthManager = UpbitAuthManager()

    @Provides
    @Singleton
    fun provideUpbitRepository(
        apiService: UpbitApiService,
        authManager: UpbitAuthManager
    ): UpbitRepository = UpbitRepository(apiService, authManager)

    @Provides
    @Singleton
    fun provideSettingsManager(@ApplicationContext context: Context): SettingsManager =
        SettingsManager(context)

    @Provides
    @Singleton
    fun provideNotificationHelper(@ApplicationContext context: Context): NotificationHelper =
        NotificationHelper(context)
}
