package com.autoprofit.bot.utils

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.autoprofit.bot.AutoProfitApplication
import com.autoprofit.bot.MainActivity
import com.autoprofit.bot.R
import com.autoprofit.bot.trading.models.NotificationType
import com.autoprofit.bot.trading.models.TradeNotification
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import java.text.NumberFormat
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationHelper @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val krwFormat = NumberFormat.getNumberInstance(Locale.KOREA)
    private var notifIdCounter = 2000

    // ── 매수 알림 ─────────────────────────────────────
    fun sendBuyNotification(notif: TradeNotification) {
        val ticker = notif.ticker.substringAfter("-")
        val title  = "🟢 매수 체결 - $ticker"
        val body   = buildString {
            append("💰 ${krwFormat.format(notif.investmentKrw.toLong())}원 매수\n")
            append("📊 체결가: ${krwFormat.format(notif.price.toLong())}원\n")
            append("⚡ 전략: ${notif.strategy}\n")
            append("📝 사유: ${notif.reason}")
        }

        sendNotification(
            id       = notifIdCounter++,
            channel  = AutoProfitApplication.CHANNEL_BUY_ALERT,
            title    = title,
            body     = body,
            ticker   = notif.ticker
        )
        Timber.d("매수 알림 전송: $ticker")
    }

    // ── 매도 알림 ─────────────────────────────────────
    fun sendSellNotification(notif: TradeNotification) {
        val ticker     = notif.ticker.substringAfter("-")
        val isProfit   = notif.profitLossKrw >= 0
        val emoji      = if (isProfit) "🔴" else "🔵"
        val profitEmoji= if (isProfit) "💰" else "💸"

        val title = "$emoji 매도 체결 - $ticker"
        val body  = buildString {
            append("$profitEmoji 손익: ${if (isProfit) "+" else ""}${krwFormat.format(notif.profitLossKrw.toLong())}원\n")
            append("📈 수익률: ${String.format("%+.2f", notif.profitLossPct)}%\n")
            append("💹 체결가: ${krwFormat.format(notif.price.toLong())}원\n")
            append("📝 사유: ${notif.reason}")
        }

        val channel = when (notif.type) {
            NotificationType.STOP_LOSS -> AutoProfitApplication.CHANNEL_WARNING
            else -> AutoProfitApplication.CHANNEL_SELL_ALERT
        }

        sendNotification(
            id       = notifIdCounter++,
            channel  = channel,
            title    = title,
            body     = body,
            ticker   = notif.ticker
        )
        Timber.d("매도 알림 전송: $ticker | ${String.format("%+.2f", notif.profitLossPct)}%")
    }

    // ── 일일 요약 알림 ────────────────────────────────
    fun sendDailySummaryNotification(
        totalProfitKrw: Double,
        winCount: Int,
        lossCount: Int,
        winRate: Double,
        balance: Double
    ) {
        val isProfit = totalProfitKrw >= 0
        val emoji    = if (isProfit) "📈" else "📉"
        val title    = "$emoji 오늘의 거래 결과"
        val body     = buildString {
            append("💰 오늘 손익: ${if (isProfit) "+" else ""}${krwFormat.format(totalProfitKrw.toLong())}원\n")
            append("🏆 승/패: ${winCount}승 ${lossCount}패 (승률 ${String.format("%.1f", winRate)}%)\n")
            append("💵 현재 잔고: ${krwFormat.format(balance.toLong())}원")
        }

        sendNotification(
            id      = 3000,
            channel = AutoProfitApplication.CHANNEL_PROFIT_SUMMARY,
            title   = title,
            body    = body
        )
    }

    // ── 경고 알림 ─────────────────────────────────────
    fun sendWarningNotification(title: String, message: String) {
        sendNotification(
            id      = notifIdCounter++,
            channel = AutoProfitApplication.CHANNEL_WARNING,
            title   = "⚠️ $title",
            body    = message
        )
        Timber.w("경고 알림: $title - $message")
    }

    // ── 오류 알림 ─────────────────────────────────────
    fun sendErrorNotification(title: String, message: String) {
        sendNotification(
            id      = notifIdCounter++,
            channel = AutoProfitApplication.CHANNEL_WARNING,
            title   = "🚨 $title",
            body    = message
        )
        Timber.e("오류 알림: $title - $message")
    }

    // ── 공통 알림 전송 ────────────────────────────────
    private fun sendNotification(
        id: Int,
        channel: String,
        title: String,
        body: String,
        ticker: String? = null
    ) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            ticker?.let { putExtra("ticker", it) }
        }
        val pendingIntent = PendingIntent.getActivity(
            context, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(context, channel)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.drawable.ic_bot_notification)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        try {
            manager.notify(id, notification)
        } catch (e: Exception) {
            Timber.e(e, "알림 전송 실패")
        }
    }
}
