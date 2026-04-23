package com.autoprofit.bot

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.autoprofit.bot.ui.screens.*
import com.autoprofit.bot.ui.theme.*
import com.autoprofit.bot.viewmodel.TradingViewModel
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val viewModel: TradingViewModel by viewModels()

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Timber.d("알림 권한: $granted")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermission()

        setContent {
            AutoProfitBotTheme {
                AutoProfitBotApp(viewModel)
            }
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}

// =============================================
// 앱 루트 컴포저블 (하단 내비게이션)
// =============================================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AutoProfitBotApp(viewModel: TradingViewModel) {
    val botState  by viewModel.botState.collectAsState()
    val settings  by viewModel.settings.collectAsState()
    val positions by viewModel.positions.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val error     by viewModel.errorMessage.collectAsState()

    var currentTab by remember { mutableStateOf(0) }

    // 오류 스낵바
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(error) {
        error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            if (currentTab != 3) {  // 설정 화면엔 하단바 숨김
                AutoProfitBottomBar(currentTab) { currentTab = it }
            }
        },
        containerColor = DarkBackground
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            AnimatedContent(
                targetState = currentTab,
                transitionSpec = {
                    (fadeIn() + slideInHorizontally()).togetherWith(
                        fadeOut() + slideOutHorizontally()
                    )
                },
                label = "tab_transition"
            ) { tab ->
                when (tab) {
                    0 -> DashboardScreen(
                        botState       = botState,
                        positions      = positions,
                        onStartBot     = { viewModel.startBot() },
                        onStopBot      = { viewModel.stopBot() },
                        onSettingsClick = { currentTab = 3 }
                    )
                    1 -> PositionsScreen(
                        positions = positions,
                        priceMap  = viewModel.priceMap.collectAsState().value
                    )
                    2 -> HistoryScreen(
                        tradeHistory = viewModel.tradeHistory.collectAsState().value
                    )
                    3 -> SettingsScreen(
                        settings            = settings,
                        isLoading           = isLoading,
                        onSaveSettings      = { viewModel.saveSettings(it) },
                        onValidateApiKeys   = { a, s, cb -> viewModel.validateApiKeys(a, s, cb) },
                        onBack              = { currentTab = 0 }
                    )
                }
            }
        }
    }
}

// =============================================
// 하단 내비게이션 바
// =============================================
@Composable
fun AutoProfitBottomBar(currentTab: Int, onTabSelected: (Int) -> Unit) {
    val items = listOf(
        BottomNavItem(0, "대시보드", Icons.Default.Dashboard),
        BottomNavItem(1, "포지션",   Icons.Default.ShowChart),
        BottomNavItem(2, "거래기록", Icons.Default.History),
        BottomNavItem(3, "설정",     Icons.Default.Settings)
    )

    NavigationBar(
        containerColor = CardDark,
        tonalElevation = 0.dp
    ) {
        items.forEach { item ->
            NavigationBarItem(
                selected = currentTab == item.index,
                onClick  = { onTabSelected(item.index) },
                icon     = {
                    Icon(item.icon, item.label, modifier = Modifier.size(22.dp))
                },
                label    = { Text(item.label, fontSize = 11.sp) },
                colors   = NavigationBarItemDefaults.colors(
                    selectedIconColor   = BuyBlue,
                    selectedTextColor   = BuyBlue,
                    unselectedIconColor = NeutralGray,
                    unselectedTextColor = NeutralGray,
                    indicatorColor      = BuyBlue.copy(alpha = 0.15f)
                )
            )
        }
    }
}

data class BottomNavItem(val index: Int, val label: String, val icon: ImageVector)
