package com.autoprofit.bot.utils

import android.content.Context
import android.content.SharedPreferences
import com.autoprofit.bot.trading.models.AppSettings
import com.autoprofit.bot.trading.models.TradingMode
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    constructor(context: Context) : this(context)

    private val prefs: SharedPreferences =
        context.getSharedPreferences("autoprofit_settings", Context.MODE_PRIVATE)
    private val gson = Gson()

    fun getSettings(): AppSettings {
        return AppSettings(
            tradingMode         = TradingMode.valueOf(prefs.getString("trading_mode", TradingMode.PAPER.name)!!),
            upbitAccessKey      = prefs.getString("access_key", "") ?: "",
            upbitSecretKey      = prefs.getString("secret_key", "") ?: "",
            initialCapital      = prefs.getFloat("initial_capital", 1_000_000f).toDouble(),
            maxDailyLoss        = prefs.getFloat("max_daily_loss", 100_000f).toDouble(),
            maxPositions        = prefs.getInt("max_positions", 5),
            maxPositionRatio    = prefs.getFloat("max_position_ratio", 0.2f).toDouble(),
            selectedStrategies  = prefs.getStringSet("strategies",
                setOf("aggressive_scalping", "conservative_scalping")) ?: setOf(),
            enabledCoins        = getEnabledCoins(),
            notifyOnBuy         = prefs.getBoolean("notify_buy", true),
            notifyOnSell        = prefs.getBoolean("notify_sell", true),
            notifyOnStopLoss    = prefs.getBoolean("notify_stop_loss", true),
            notifyOnDailySummary= prefs.getBoolean("notify_daily", true),
            autoStartOnBoot     = prefs.getBoolean("auto_start_boot", false),
            exitMode            = prefs.getString("exit_mode", "aggressive") ?: "aggressive"
        )
    }

    fun saveSettings(settings: AppSettings) {
        prefs.edit().apply {
            putString("trading_mode",       settings.tradingMode.name)
            putString("access_key",         settings.upbitAccessKey)
            putString("secret_key",         settings.upbitSecretKey)
            putFloat("initial_capital",     settings.initialCapital.toFloat())
            putFloat("max_daily_loss",      settings.maxDailyLoss.toFloat())
            putInt("max_positions",         settings.maxPositions)
            putFloat("max_position_ratio",  settings.maxPositionRatio.toFloat())
            putStringSet("strategies",      settings.selectedStrategies)
            putBoolean("notify_buy",        settings.notifyOnBuy)
            putBoolean("notify_sell",       settings.notifyOnSell)
            putBoolean("notify_stop_loss",  settings.notifyOnStopLoss)
            putBoolean("notify_daily",      settings.notifyOnDailySummary)
            putBoolean("auto_start_boot",   settings.autoStartOnBoot)
            putString("exit_mode",          settings.exitMode)
            // 코인 목록 저장
            putString("enabled_coins", gson.toJson(settings.enabledCoins))
            apply()
        }
    }

    private fun getEnabledCoins(): List<String> {
        val json = prefs.getString("enabled_coins", null) ?: return AppSettings.DEFAULT_COINS
        return try {
            val type = object : TypeToken<List<String>>() {}.type
            gson.fromJson(json, type)
        } catch (e: Exception) {
            AppSettings.DEFAULT_COINS
        }
    }

    fun isFirstRun(): Boolean = prefs.getBoolean("first_run", true)
    fun setFirstRunDone() = prefs.edit().putBoolean("first_run", false).apply()

    fun clearApiKeys() {
        prefs.edit()
            .putString("access_key", "")
            .putString("secret_key", "")
            .apply()
    }
}
