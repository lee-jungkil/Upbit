package com.autoprofit.bot.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autoprofit.bot.trading.models.TradeRecord
import com.autoprofit.bot.ui.theme.*
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun HistoryScreen(tradeHistory: List<TradeRecord>) {
    val krwFmt  = NumberFormat.getNumberInstance(Locale.KOREA)
    val dateFmt = SimpleDateFormat("MM/dd HH:mm", Locale.KOREA)

    // 통계
    val sells      = tradeHistory.filter { it.action == "SELL" }
    val totalPL    = sells.sumOf { it.profitLossKrw }
    val winCount   = sells.count { it.profitLossKrw > 0 }
    val lossCount  = sells.count { it.profitLossKrw <= 0 }
    val winRate    = if (sells.isNotEmpty()) winCount.toDouble() / sells.size * 100 else 0.0

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        // 헤더
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(CardDark)
                .padding(horizontal = 20.dp, vertical = 14.dp)
        ) {
            Text("📋 거래 기록", color = TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }

        if (tradeHistory.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📭", fontSize = 64.sp)
                    Spacer(Modifier.height(16.dp))
                    Text("거래 기록이 없습니다", color = TextSecondary, fontSize = 18.sp)
                }
            }
        } else {
            // 누적 통계
            Card(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                shape    = RoundedCornerShape(12.dp),
                colors   = CardDefaults.cardColors(containerColor = CardDark)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    HistStatItem("총 손익", "${if (totalPL >= 0) "+" else ""}${krwFmt.format(totalPL.toLong())}원",
                        if (totalPL >= 0) ProfitGreen else LossRed)
                    HistStatItem("거래수", "${sells.size}회",   TextPrimary)
                    HistStatItem("승률",   "${String.format("%.1f", winRate)}%",
                        if (winRate >= 50) ProfitGreen else LossRed)
                    HistStatItem("승/패",  "${winCount}/${lossCount}", NeutralGray)
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(tradeHistory.sortedByDescending { it.timestampMs }, key = { it.id }) { record ->
                    TradeRecordCard(record, krwFmt, dateFmt)
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

@Composable
private fun HistStatItem(label: String, value: String, valueColor: androidx.compose.ui.graphics.Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = valueColor,    fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text(label, color = TextSecondary, fontSize = 11.sp)
    }
}

@Composable
private fun TradeRecordCard(record: TradeRecord, krwFmt: NumberFormat, dateFmt: SimpleDateFormat) {
    val isBuy     = record.action == "BUY"
    val isProfit  = record.profitLossKrw > 0
    val color     = if (isBuy) BuyBlue else if (isProfit) ProfitGreen else LossRed
    val actionEmoji = when {
        isBuy     -> "🟢"
        isProfit  -> "💰"
        else      -> "💸"
    }
    val actionLabel = if (isBuy) "매수" else "매도"
    val timeStr   = dateFmt.format(Date(record.timestampMs))
    val coinName  = record.ticker.substringAfter("-")

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape    = RoundedCornerShape(10.dp),
        colors   = CardDefaults.cardColors(containerColor = CardDark)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            // 왼쪽: 액션 + 코인명
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = color.copy(alpha = 0.15f),
                    modifier = Modifier.size(40.dp)
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                        Text(actionEmoji, fontSize = 18.sp)
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(coinName, color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Surface(shape = RoundedCornerShape(4.dp), color = color.copy(alpha = 0.2f)) {
                            Text(
                                actionLabel, color = color, fontSize = 10.sp,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                    Text(
                        "${record.strategy.replace("_", " ")} • $timeStr",
                        color = TextSecondary, fontSize = 11.sp
                    )
                }
            }

            // 오른쪽: 금액/손익
            Column(horizontalAlignment = Alignment.End) {
                if (isBuy) {
                    Text(
                        "${krwFmt.format(record.investmentKrw.toLong())}원",
                        color = BuyBlue, fontSize = 14.sp, fontWeight = FontWeight.Bold
                    )
                    Text("@ ${krwFmt.format(record.price.toLong())}원", color = TextSecondary, fontSize = 11.sp)
                } else {
                    Text(
                        "${if (isProfit) "+" else ""}${krwFmt.format(record.profitLossKrw.toLong())}원",
                        color = color, fontSize = 14.sp, fontWeight = FontWeight.Bold
                    )
                    Text(
                        "${if (isProfit) "+" else ""}${String.format("%.2f", record.profitLossPct)}%",
                        color = color.copy(alpha = 0.8f), fontSize = 11.sp
                    )
                }
            }
        }
    }
}
