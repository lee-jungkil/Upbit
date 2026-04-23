package com.autoprofit.bot.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autoprofit.bot.trading.models.*
import com.autoprofit.bot.ui.theme.*

@Composable
fun SettingsScreen(
    settings: AppSettings,
    isLoading: Boolean,
    onSaveSettings: (AppSettings) -> Unit,
    onValidateApiKeys: (String, String, (Boolean, String) -> Unit) -> Unit,
    onBack: () -> Unit
) {
    var currentSettings by remember { mutableStateOf(settings) }
    var apiKeyVisible   by remember { mutableStateOf(false) }
    var apiTestResult   by remember { mutableStateOf<String?>(null) }
    var showApiTestDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        // 상단 앱바
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(CardDark)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, "뒤로", tint = TextPrimary)
            }
            Text("⚙️ 설정", color = TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // ── 거래 모드 ────────────────────────────────
            SettingsSection(title = "🎮 거래 모드") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TradingMode.values().forEach { mode ->
                        val isSelected = currentSettings.tradingMode == mode
                        val btnColor   = when (mode) {
                            TradingMode.LIVE     -> LossRed
                            TradingMode.PAPER    -> BuyBlue
                            TradingMode.BACKTEST -> NeutralGray
                        }
                        FilterChip(
                            selected  = isSelected,
                            onClick   = { currentSettings = currentSettings.copy(tradingMode = mode) },
                            label     = { Text(mode.displayName, fontSize = 13.sp) },
                            modifier  = Modifier.weight(1f),
                            colors    = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = btnColor.copy(alpha = 0.25f),
                                selectedLabelColor     = btnColor,
                                containerColor         = CardDark2,
                                labelColor             = TextSecondary
                            )
                        )
                    }
                }
                if (currentSettings.tradingMode == TradingMode.LIVE) {
                    Spacer(Modifier.height(4.dp))
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = LossRed.copy(alpha = 0.1f)
                    ) {
                        Text(
                            "⚠️ 실전거래 모드는 실제 자산으로 거래됩니다. 신중하게 사용하세요.",
                            color    = LossRed,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }

            // ── API 키 설정 ──────────────────────────────
            SettingsSection(title = "🔑 Upbit API 키") {
                OutlinedTextField(
                    value         = currentSettings.upbitAccessKey,
                    onValueChange = { currentSettings = currentSettings.copy(upbitAccessKey = it) },
                    label         = { Text("Access Key") },
                    modifier      = Modifier.fillMaxWidth(),
                    colors        = textFieldColors(),
                    singleLine    = true,
                    leadingIcon   = { Icon(Icons.Default.Key, null, tint = TextSecondary) }
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value             = currentSettings.upbitSecretKey,
                    onValueChange     = { currentSettings = currentSettings.copy(upbitSecretKey = it) },
                    label             = { Text("Secret Key") },
                    modifier          = Modifier.fillMaxWidth(),
                    colors            = textFieldColors(),
                    singleLine        = true,
                    visualTransformation = if (apiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    leadingIcon       = { Icon(Icons.Default.Lock, null, tint = TextSecondary) },
                    trailingIcon      = {
                        IconButton(onClick = { apiKeyVisible = !apiKeyVisible }) {
                            Icon(
                                if (apiKeyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                null, tint = TextSecondary
                            )
                        }
                    }
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        onValidateApiKeys(
                            currentSettings.upbitAccessKey,
                            currentSettings.upbitSecretKey
                        ) { ok, msg ->
                            apiTestResult = msg
                            showApiTestDialog = true
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors   = ButtonDefaults.buttonColors(containerColor = BuyBlue),
                    enabled  = !isLoading &&
                                currentSettings.upbitAccessKey.isNotEmpty() &&
                                currentSettings.upbitSecretKey.isNotEmpty()
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(
                            color    = Color.White,
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("API 키 검증")
                    }
                }
            }

            // ── 자금 관리 ────────────────────────────────
            SettingsSection(title = "💰 자금 관리") {
                LabeledSlider(
                    label    = "초기 자본금",
                    value    = currentSettings.initialCapital,
                    range    = 100_000.0..10_000_000.0,
                    format   = { "${String.format("%,.0f", it)}원" },
                    onChange = { currentSettings = currentSettings.copy(initialCapital = it) }
                )
                Spacer(Modifier.height(8.dp))
                LabeledSlider(
                    label    = "일일 최대 손실",
                    value    = currentSettings.maxDailyLoss,
                    range    = 10_000.0..1_000_000.0,
                    format   = { "${String.format("%,.0f", it)}원" },
                    onChange = { currentSettings = currentSettings.copy(maxDailyLoss = it) }
                )
                Spacer(Modifier.height(8.dp))
                LabeledSlider(
                    label    = "최대 동시 포지션",
                    value    = currentSettings.maxPositions.toDouble(),
                    range    = 1.0..10.0,
                    format   = { "${it.toInt()}개" },
                    onChange = { currentSettings = currentSettings.copy(maxPositions = it.toInt()) },
                    steps    = 8
                )
                Spacer(Modifier.height(8.dp))
                LabeledSlider(
                    label    = "포지션당 최대 비율",
                    value    = currentSettings.maxPositionRatio * 100,
                    range    = 5.0..50.0,
                    format   = { "${it.toInt()}%" },
                    onChange = { currentSettings = currentSettings.copy(maxPositionRatio = it / 100) }
                )
            }

            // ── 전략 선택 ────────────────────────────────
            SettingsSection(title = "📈 거래 전략") {
                val strategyOptions = listOf(
                    "aggressive_scalping"   to "⚡ 공격적 스캘핑 (익절+1.5%/손절-1.0%/4분)",
                    "conservative_scalping" to "🛡 보수적 스캘핑 (익절+2.0%/손절-1.5%/8분)",
                    "mean_reversion"        to "📊 평균 회귀 (익절+3.0%/손절-2.0%/30분)",
                    "grid_trading"          to "🔲 그리드 트레이딩 (익절+5.0%/손절-3.0%/60분)",
                    "ultra_scalping"        to "🚀 초단타 (익절+0.8%/손절-0.5%/3분)"
                )
                strategyOptions.forEach { (key, label) ->
                    val isSelected = key in currentSettings.selectedStrategies
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                val updated = if (isSelected)
                                    currentSettings.selectedStrategies - key
                                else
                                    currentSettings.selectedStrategies + key
                                if (updated.isNotEmpty())
                                    currentSettings = currentSettings.copy(selectedStrategies = updated)
                            }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(
                            checked  = isSelected,
                            onCheckedChange = null,
                            colors   = CheckboxDefaults.colors(checkedColor = BuyBlue, uncheckedColor = NeutralGray)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(label, color = if (isSelected) TextPrimary else TextSecondary, fontSize = 13.sp)
                    }
                }
            }

            // ── 청산 전략 ────────────────────────────────
            SettingsSection(title = "🎯 청산 모드") {
                listOf("aggressive" to "공격적 (빠른 청산)", "moderate" to "균형 (중간)", "conservative" to "보수적 (느린 청산)").forEach { (key, label) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { currentSettings = currentSettings.copy(exitMode = key) }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = currentSettings.exitMode == key,
                            onClick  = { currentSettings = currentSettings.copy(exitMode = key) },
                            colors   = RadioButtonDefaults.colors(selectedColor = BuyBlue)
                        )
                        Text(label, color = TextPrimary, fontSize = 14.sp)
                    }
                }
            }

            // ── 알림 설정 ────────────────────────────────
            SettingsSection(title = "🔔 알림 설정") {
                listOf(
                    "매수 체결 알림"   to currentSettings.notifyOnBuy,
                    "매도 체결 알림"   to currentSettings.notifyOnSell,
                    "손절 알림"        to currentSettings.notifyOnStopLoss,
                    "일일 요약 알림"   to currentSettings.notifyOnDailySummary
                ).forEachIndexed { idx, (label, checked) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(label, color = TextPrimary, fontSize = 14.sp)
                        Switch(
                            checked  = checked,
                            onCheckedChange = { v ->
                                currentSettings = when (idx) {
                                    0 -> currentSettings.copy(notifyOnBuy = v)
                                    1 -> currentSettings.copy(notifyOnSell = v)
                                    2 -> currentSettings.copy(notifyOnStopLoss = v)
                                    3 -> currentSettings.copy(notifyOnDailySummary = v)
                                    else -> currentSettings
                                }
                            },
                            colors = SwitchDefaults.colors(checkedThumbColor = BuyBlue, checkedTrackColor = BuyBlue.copy(alpha = 0.4f))
                        )
                    }
                }
                Divider(color = DividerColor)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("부팅 시 자동 시작", color = TextPrimary, fontSize = 14.sp)
                    Switch(
                        checked = currentSettings.autoStartOnBoot,
                        onCheckedChange = { currentSettings = currentSettings.copy(autoStartOnBoot = it) },
                        colors = SwitchDefaults.colors(checkedThumbColor = ProfitGreen, checkedTrackColor = ProfitGreen.copy(alpha = 0.4f))
                    )
                }
            }

            // 저장 버튼
            Button(
                onClick  = { onSaveSettings(currentSettings) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape  = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = ProfitGreen)
            ) {
                Icon(Icons.Default.Save, null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("설정 저장", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }

            Spacer(Modifier.height(32.dp))
        }
    }

    // API 검증 결과 다이얼로그
    if (showApiTestDialog) {
        AlertDialog(
            onDismissRequest = { showApiTestDialog = false },
            title            = { Text("API 검증 결과") },
            text             = { Text(apiTestResult ?: "") },
            confirmButton    = {
                TextButton(onClick = { showApiTestDialog = false }) { Text("확인") }
            },
            containerColor   = CardDark
        )
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape    = RoundedCornerShape(16.dp),
        colors   = CardDefaults.cardColors(containerColor = CardDark)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            content()
        }
    }
}

@Composable
private fun LabeledSlider(
    label: String, value: Double, range: ClosedFloatingPointRange<Double>,
    format: (Double) -> String, onChange: (Double) -> Unit, steps: Int = 0
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = TextSecondary, fontSize = 13.sp)
        Text(format(value), color = BuyBlue, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
    Slider(
        value         = value.toFloat(),
        onValueChange = { onChange(it.toDouble()) },
        valueRange    = range.start.toFloat()..range.endInclusive.toFloat(),
        steps         = steps,
        colors        = SliderDefaults.colors(thumbColor = BuyBlue, activeTrackColor = BuyBlue)
    )
}

@Composable
private fun textFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor   = BuyBlue,
    unfocusedBorderColor = DividerColor,
    focusedLabelColor    = BuyBlue,
    unfocusedLabelColor  = TextSecondary,
    cursorColor          = BuyBlue,
    focusedTextColor     = TextPrimary,
    unfocusedTextColor   = TextPrimary
)
