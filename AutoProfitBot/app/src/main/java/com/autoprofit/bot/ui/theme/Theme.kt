package com.autoprofit.bot.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ── 색상 팔레트 ────────────────────────────────────
val ProfitGreen    = Color(0xFF00C853)
val ProfitGreenDim = Color(0xFF1B5E20)
val LossRed        = Color(0xFFFF1744)
val LossRedDim     = Color(0xFF7F0000)
val BuyBlue        = Color(0xFF2196F3)
val SellOrange     = Color(0xFFFF6D00)
val NeutralGray    = Color(0xFF9E9E9E)
val DarkBackground = Color(0xFF0D0D0D)
val CardDark       = Color(0xFF1A1A2E)
val CardDark2      = Color(0xFF16213E)
val AccentGold     = Color(0xFFFFD700)
val TextPrimary    = Color(0xFFFFFFFF)
val TextSecondary  = Color(0xFFB0B0B0)
val DividerColor   = Color(0xFF2A2A2A)

private val DarkColorScheme = darkColorScheme(
    primary         = BuyBlue,
    onPrimary       = Color.White,
    secondary       = ProfitGreen,
    onSecondary     = Color.Black,
    tertiary        = AccentGold,
    background      = DarkBackground,
    surface         = CardDark,
    onBackground    = TextPrimary,
    onSurface       = TextPrimary,
    error           = LossRed,
    onError         = Color.White,
    outline         = DividerColor,
    surfaceVariant  = CardDark2,
    onSurfaceVariant= TextSecondary
)

@Composable
fun AutoProfitBotTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography  = Typography(),
        content     = content
    )
}
