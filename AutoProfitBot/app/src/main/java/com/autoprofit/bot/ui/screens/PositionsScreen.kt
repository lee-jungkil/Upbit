package com.autoprofit.bot.ui.screens

import androidx.compose.foundation.*
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
import com.autoprofit.bot.trading.models.Position
import com.autoprofit.bot.ui.theme.*
import java.text.NumberFormat
import java.util.Locale

@Composable
fun PositionsScreen(
    positions: List<Position>,
    priceMap: Map<String, Double>
) {
    val krwFmt = NumberFormat.getNumberInstance(Locale.KOREA)

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
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("📊 보유 포지션", color = TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = BuyBlue.copy(alpha = 0.2f)
                ) {
                    Text(
                        "${positions.size}개",
                        color = BuyBlue, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                    )
                }
            }
        }

        if (positions.isEmpty()) {
            // 포지션 없음
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📭", fontSize = 64.sp)
                    Spacer(Modifier.height(16.dp))
                    Text("보유 포지션이 없습니다", color = TextSecondary, fontSize = 18.sp)
                    Spacer(Modifier.height(8.dp))
                    Text("봇이 실행 중이면 자동으로 매수 포지션이 생성됩니다", color = NeutralGray, fontSize = 13.sp, textAlign = TextAlign.Center)
                }
            }
        } else {
            // 요약 바
            val totalInvested   = positions.sumOf { it.investmentKrw }
            val totalCurrentVal = positions.sumOf { it.currentValueKrw }
            val totalPL         = totalCurrentVal - totalInvested
            val totalPLPct      = if (totalInvested > 0) totalPL / totalInvested * 100 else 0.0
            val plColor         = if (totalPL >= 0) ProfitGreen else LossRed

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                shape  = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = CardDark2)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    SummaryItem("총 투자", "${krwFmt.format(totalInvested.toLong())}원", SellOrange)
                    SummaryItem("현재 평가", "${krwFmt.format(totalCurrentVal.toLong())}원", BuyBlue)
                    SummaryItem(
                        "평가 손익",
                        "${if (totalPL >= 0) "+" else ""}${krwFmt.format(totalPL.toLong())}원\n(${String.format("%+.2f", totalPLPct)}%)",
                        plColor
                    )
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(positions, key = { it.ticker }) { position ->
                    DetailedPositionCard(position, krwFmt)
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

@Composable
private fun SummaryItem(label: String, value: String, color: com.autoprofit.bot.ui.theme.Color = TextPrimary) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = color, fontSize = 13.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text(label, color = TextSecondary, fontSize = 11.sp)
    }
}

@Composable
private fun DetailedPositionCard(pos: Position, krwFmt: NumberFormat) {
    val profitColor = if (pos.isProfit) ProfitGreen else LossRed
    val profitBg    = if (pos.isProfit) ProfitGreen.copy(alpha = 0.06f) else LossRed.copy(alpha = 0.06f)

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape  = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = CardDark)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // 상단: 코인명 + 수익률
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment     = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BuyBlue.copy(alpha = 0.15f),
                        modifier = Modifier.size(44.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                            Text(
                                pos.coinName.take(3),
                                color = BuyBlue, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(pos.coinName, color = TextPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text(
                            pos.strategy.replace("_", " ").replaceFirstChar { it.uppercase() },
                            color = TextSecondary, fontSize = 11.sp
                        )
                    }
                }

                Surface(shape = RoundedCornerShape(10.dp), color = profitBg) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        Text(
                            "${if (pos.isProfit) "+" else ""}${String.format("%.2f", pos.profitLossRatio)}%",
                            color = profitColor, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold
                        )
                        Text(
                            "${if (pos.isProfit) "+" else ""}${krwFmt.format(pos.profitLossKrw.toLong())}원",
                            color = profitColor, fontSize = 12.sp
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // 가격 정보
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = CardDark2
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    PriceInfoCol("평균 매수가", "${krwFmt.format(pos.avgBuyPrice.toLong())}원", NeutralGray)
                    Divider(modifier = Modifier.width(1.dp).height(36.dp), color = DividerColor)
                    PriceInfoCol("현재가", "${krwFmt.format(pos.currentPrice.toLong())}원", TextPrimary)
                    Divider(modifier = Modifier.width(1.dp).height(36.dp), color = DividerColor)
                    PriceInfoCol("보유 수량", String.format("%.6f", pos.amount), TextSecondary)
                    Divider(modifier = Modifier.width(1.dp).height(36.dp), color = DividerColor)
                    PriceInfoCol("보유 시간", "${pos.holdingMinutes}분", AccentGold)
                }
            }

            Spacer(Modifier.height(8.dp))

            // 손절/익절 라인
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PriceTag(
                    "🔴 손절가",
                    "${krwFmt.format(pos.stopLossPrice.toLong())}원",
                    LossRed, Modifier.weight(1f)
                )
                PriceTag(
                    "🟢 익절가",
                    "${krwFmt.format(pos.takeProfitPrice.toLong())}원",
                    ProfitGreen, Modifier.weight(1f)
                )
                if (pos.trailingStopPrice > 0) {
                    PriceTag(
                        "🔵 트레일링",
                        "${krwFmt.format(pos.trailingStopPrice.toLong())}원",
                        BuyBlue, Modifier.weight(1f)
                    )
                }
            }
        }
    }
}

@Composable
private fun PriceInfoCol(label: String, value: String, valueColor: androidx.compose.ui.graphics.Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = valueColor, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(label, color = TextSecondary, fontSize = 10.sp)
    }
}

@Composable
private fun PriceTag(label: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, shape = RoundedCornerShape(8.dp), color = color.copy(alpha = 0.1f)) {
        Column(
            modifier = Modifier.padding(8.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(label,  color = color,        fontSize = 10.sp)
            Text(value,  color = TextPrimary,  fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
    }
}

// 색상 별칭 (테마 충돌 방지)
private val Color = androidx.compose.ui.graphics.Color
