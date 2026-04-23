package com.autoprofit.bot.ui.screens

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autoprofit.bot.trading.models.*
import com.autoprofit.bot.ui.theme.*
import java.text.NumberFormat
import java.util.Locale

@Composable
fun DashboardScreen(
    botState: BotState,
    positions: List<Position>,
    onStartBot: () -> Unit,
    onStopBot: () -> Unit,
    onSettingsClick: () -> Unit
) {
    val krwFmt = NumberFormat.getNumberInstance(Locale.KOREA)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .verticalScroll(rememberScrollState())
    ) {
        // ── 헤더 ──────────────────────────────────────
        DashboardHeader(botState, onSettingsClick)

        Spacer(Modifier.height(12.dp))

        // ── 봇 제어 버튼 ───────────────────────────────
        BotControlCard(botState, onStartBot, onStopBot)

        Spacer(Modifier.height(12.dp))

        // ── 잔고/수익 요약 카드 ─────────────────────────
        BalanceSummaryCard(botState, krwFmt)

        Spacer(Modifier.height(12.dp))

        // ── 오늘 통계 카드 ─────────────────────────────
        TodayStatsCard(botState)

        Spacer(Modifier.height(12.dp))

        // ── 포지션 목록 ────────────────────────────────
        if (positions.isNotEmpty()) {
            PositionsSection(positions, krwFmt)
        } else {
            EmptyPositionsCard(botState.status)
        }

        Spacer(Modifier.height(80.dp))
    }
}

// =============================================
// 헤더
// =============================================
@Composable
private fun DashboardHeader(botState: BotState, onSettingsClick: () -> Unit) {
    val statusColor = when (botState.status) {
        BotStatus.RUNNING -> ProfitGreen
        BotStatus.PAUSED  -> AccentGold
        BotStatus.ERROR   -> LossRed
        else              -> NeutralGray
    }
    val statusText = when (botState.status) {
        BotStatus.RUNNING -> "● 실행 중"
        BotStatus.PAUSED  -> "⏸ 일시정지"
        BotStatus.ERROR   -> "✕ 오류"
        else              -> "○ 중지됨"
    }
    val modeText = botState.mode.displayName
    val modeBadgeColor = when (botState.mode) {
        TradingMode.LIVE     -> LossRed
        TradingMode.PAPER    -> BuyBlue
        TradingMode.BACKTEST -> NeutralGray
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(listOf(CardDark, DarkBackground))
            )
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text       = "🤖 AutoProfit Bot",
                    color      = TextPrimary,
                    fontSize   = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(statusText, color = statusColor, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = modeBadgeColor.copy(alpha = 0.2f)
                    ) {
                        Text(
                            text     = modeText,
                            color    = modeBadgeColor,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                }
            }
            IconButton(onClick = onSettingsClick) {
                Icon(Icons.Default.Settings, "설정", tint = TextSecondary)
            }
        }
    }
}

// =============================================
// 봇 제어 카드
// =============================================
@Composable
private fun BotControlCard(
    botState: BotState,
    onStartBot: () -> Unit,
    onStopBot: () -> Unit
) {
    val isRunning = botState.status == BotStatus.RUNNING
    val pulsating by rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 0.85f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "scale"
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape  = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CardDark)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment     = Alignment.CenterVertically
        ) {
            // 시작/중지 버튼
            Button(
                onClick = if (isRunning) onStopBot else onStartBot,
                colors  = ButtonDefaults.buttonColors(
                    containerColor = if (isRunning) LossRed else ProfitGreen
                ),
                modifier = Modifier
                    .weight(1f)
                    .height(52.dp),
                shape    = RoundedCornerShape(12.dp)
            ) {
                Icon(
                    imageVector  = if (isRunning) Icons.Default.Stop else Icons.Default.PlayArrow,
                    contentDescription = null,
                    modifier     = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text       = if (isRunning) "중지" else "시작",
                    fontSize   = 16.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(Modifier.width(12.dp))

            // 상태 인디케이터
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    modifier = Modifier
                        .size(if (isRunning) (16 * pulsating).dp else 16.dp)
                        .clip(CircleShape)
                        .background(
                            when (botState.status) {
                                BotStatus.RUNNING -> ProfitGreen
                                BotStatus.PAUSED  -> AccentGold
                                BotStatus.ERROR   -> LossRed
                                else              -> NeutralGray
                            }
                        )
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text     = if (isRunning) "LIVE" else "OFF",
                    color    = if (isRunning) ProfitGreen else NeutralGray,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

// =============================================
// 잔고/수익 요약 카드
// =============================================
@Composable
private fun BalanceSummaryCard(botState: BotState, krwFmt: NumberFormat) {
    val profitColor = if (botState.dailyProfitKrw >= 0) ProfitGreen else LossRed

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape  = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CardDark)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("💰 자산 현황", color = TextSecondary, fontSize = 13.sp)
            Spacer(Modifier.height(12.dp))

            // 총 잔고
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("가용 잔고", color = TextSecondary, fontSize = 14.sp)
                Text(
                    "${krwFmt.format(botState.availableBalance.toLong())}원",
                    color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold
                )
            }

            Spacer(Modifier.height(8.dp))
            Divider(color = DividerColor)
            Spacer(Modifier.height(8.dp))

            // 투자 중
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("투자 중", color = TextSecondary, fontSize = 14.sp)
                Text(
                    "${krwFmt.format(botState.totalInvested.toLong())}원",
                    color = SellOrange, fontSize = 15.sp, fontWeight = FontWeight.Medium
                )
            }

            Spacer(Modifier.height(8.dp))
            Divider(color = DividerColor)
            Spacer(Modifier.height(12.dp))

            // 오늘 손익 (크게)
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text("오늘 손익", color = TextSecondary, fontSize = 13.sp, textAlign = TextAlign.Center)
                Text(
                    text       = "${if (botState.dailyProfitKrw >= 0) "+" else ""}${krwFmt.format(botState.dailyProfitKrw.toLong())}원",
                    color      = profitColor,
                    fontSize   = 28.sp,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign  = TextAlign.Center
                )
            }
        }
    }
}

// =============================================
// 오늘 통계 카드
// =============================================
@Composable
private fun TodayStatsCard(botState: BotState) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape  = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CardDark)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalArrangement = Arrangement.SpaceAround
        ) {
            StatItem("거래", "${botState.todayTradeCount}회",  TextPrimary)
            StatItem("승", "${botState.winCount}승",            ProfitGreen)
            StatItem("패", "${botState.lossCount}패",           LossRed)
            StatItem("승률", "${String.format("%.1f", botState.winRate)}%",
                if (botState.winRate >= 50) ProfitGreen else LossRed)
            StatItem("포지션", "${botState.positions.size}개",  BuyBlue)
        }
    }
}

@Composable
private fun StatItem(label: String, value: String, valueColor: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = valueColor,   fontSize = 16.sp, fontWeight = FontWeight.Bold)
        Text(label, color = TextSecondary, fontSize = 11.sp)
    }
}

// =============================================
// 포지션 섹션
// =============================================
@Composable
private fun PositionsSection(positions: List<Position>, krwFmt: NumberFormat) {
    Column(modifier = Modifier.padding(horizontal = 16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment     = Alignment.CenterVertically
        ) {
            Text("📊 보유 포지션", color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Text("${positions.size}개", color = BuyBlue, fontSize = 14.sp)
        }
        Spacer(Modifier.height(8.dp))

        positions.forEach { position ->
            PositionCard(position, krwFmt)
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun PositionCard(pos: Position, krwFmt: NumberFormat) {
    val profitColor = if (pos.isProfit) ProfitGreen else LossRed
    val profitBg    = if (pos.isProfit) ProfitGreen.copy(alpha = 0.08f) else LossRed.copy(alpha = 0.08f)

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape  = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = CardDark2)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment     = Alignment.CenterVertically
            ) {
                // 코인명 + 전략
                Column {
                    Text(
                        pos.coinName, color = TextPrimary,
                        fontSize = 18.sp, fontWeight = FontWeight.Bold
                    )
                    Text(pos.strategy.replace("_", " "), color = TextSecondary, fontSize = 11.sp)
                }

                // 수익률 배지
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = profitBg
                ) {
                    Text(
                        text       = "${if (pos.isProfit) "+" else ""}${String.format("%.2f", pos.profitLossRatio)}%",
                        color      = profitColor,
                        fontSize   = 20.sp,
                        fontWeight = FontWeight.ExtraBold,
                        modifier   = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Divider(color = DividerColor)
            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                PosInfoItem("매수가", "${krwFmt.format(pos.avgBuyPrice.toLong())}원")
                PosInfoItem("현재가", "${krwFmt.format(pos.currentPrice.toLong())}원")
                PosInfoItem("손익", "${if (pos.isProfit) "+" else ""}${krwFmt.format(pos.profitLossKrw.toLong())}원", profitColor)
                PosInfoItem("보유", "${pos.holdingMinutes}분")
            }

            Spacer(Modifier.height(8.dp))

            // 손절/익절 라인
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                InfoBadge("손절 ${krwFmt.format(pos.stopLossPrice.toLong())}",   LossRed,    Modifier.weight(1f))
                InfoBadge("익절 ${krwFmt.format(pos.takeProfitPrice.toLong())}",  ProfitGreen, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun PosInfoItem(label: String, value: String, valueColor: Color = TextPrimary) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = valueColor, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(label, color = TextSecondary, fontSize = 10.sp)
    }
}

@Composable
private fun InfoBadge(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, shape = RoundedCornerShape(6.dp), color = color.copy(alpha = 0.12f)) {
        Text(
            text      = text,
            color     = color,
            fontSize  = 11.sp,
            textAlign = TextAlign.Center,
            modifier  = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp, horizontal = 6.dp)
        )
    }
}

// =============================================
// 포지션 없음 카드
// =============================================
@Composable
private fun EmptyPositionsCard(status: BotStatus) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape  = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CardDark)
    ) {
        Column(
            modifier              = Modifier
                .fillMaxWidth()
                .padding(40.dp),
            horizontalAlignment   = Alignment.CenterHorizontally
        ) {
            Text("📊", fontSize = 48.sp)
            Spacer(Modifier.height(12.dp))
            Text(
                text      = if (status == BotStatus.RUNNING) "시장 스캔 중..." else "포지션 없음",
                color     = TextSecondary,
                fontSize  = 16.sp,
                textAlign = TextAlign.Center
            )
            if (status == BotStatus.STOPPED) {
                Spacer(Modifier.height(8.dp))
                Text("봇을 시작하면 자동으로 매수 시점을 탐색합니다", color = NeutralGray, fontSize = 13.sp, textAlign = TextAlign.Center)
            }
        }
    }
}
