package com.autoprofit.bot.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.autoprofit.bot.utils.SettingsManager
import timber.log.Timber

/**
 * 부팅 완료 시 자동매매 서비스 자동 시작
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED &&
            intent?.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val settings = SettingsManager(context).getSettings()
        if (!settings.autoStartOnBoot) return

        Timber.d("부팅 완료 - 자동매매 서비스 시작")

        val serviceIntent = Intent(context, TradingService::class.java).apply {
            action = TradingService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}
