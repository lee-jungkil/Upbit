package com.autoprofit.bot

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import dagger.hilt.android.HiltAndroidApp
import timber.log.Timber

@HiltAndroidApp
class AutoProfitApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        Timber.plant(Timber.DebugTree())
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // 서비스 실행 중 알림 채널
            NotificationChannel(
                CHANNEL_TRADING_SERVICE,
                "자동매매 실행 중",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "AutoProfitBot 백그라운드 실행 상태"
                setShowBadge(false)
                manager.createNotificationChannel(this)
            }

            // 매수 알림 채널
            NotificationChannel(
                CHANNEL_BUY_ALERT,
                "매수 알림",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "코인 매수 시 알림"
                enableVibration(true)
                manager.createNotificationChannel(this)
            }

            // 매도 알림 채널
            NotificationChannel(
                CHANNEL_SELL_ALERT,
                "매도 알림",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "코인 매도 및 수익 실현 시 알림"
                enableVibration(true)
                manager.createNotificationChannel(this)
            }

            // 손익 요약 채널
            NotificationChannel(
                CHANNEL_PROFIT_SUMMARY,
                "손익 요약",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "주기적 손익 요약 알림"
                manager.createNotificationChannel(this)
            }

            // 경고/오류 채널
            NotificationChannel(
                CHANNEL_WARNING,
                "경고 알림",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "리스크 경고 및 오류 알림"
                enableVibration(true)
                manager.createNotificationChannel(this)
            }
        }
    }

    companion object {
        const val CHANNEL_TRADING_SERVICE = "trading_service"
        const val CHANNEL_BUY_ALERT      = "buy_alert"
        const val CHANNEL_SELL_ALERT     = "sell_alert"
        const val CHANNEL_PROFIT_SUMMARY = "profit_summary"
        const val CHANNEL_WARNING        = "warning_alert"
    }
}
