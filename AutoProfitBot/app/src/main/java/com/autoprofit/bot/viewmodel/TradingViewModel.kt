package com.autoprofit.bot.viewmodel

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.autoprofit.bot.api.UpbitRepository
import com.autoprofit.bot.service.TradingService
import com.autoprofit.bot.trading.models.*
import com.autoprofit.bot.trading.strategies.StrategyFactory
import com.autoprofit.bot.utils.SettingsManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import timber.log.Timber
import javax.inject.Inject
import java.text.NumberFormat
import java.util.Locale

@HiltViewModel
class TradingViewModel @Inject constructor(
    application: Application,
    private val repository: UpbitRepository,
    private val settingsManager: SettingsManager
) : AndroidViewModel(application) {

    // ── UI 상태 ────────────────────────────────────────
    private val _botState       = MutableStateFlow(BotState())
    val botState: StateFlow<BotState> = _botState.asStateFlow()

    private val _settings       = MutableStateFlow(AppSettings())
    val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    private val _positions      = MutableStateFlow<List<Position>>(emptyList())
    val positions: StateFlow<List<Position>> = _positions.asStateFlow()

    private val _tradeHistory   = MutableStateFlow<List<TradeRecord>>(emptyList())
    val tradeHistory: StateFlow<List<TradeRecord>> = _tradeHistory.asStateFlow()

    private val _priceMap       = MutableStateFlow<Map<String, Double>>(emptyMap())
    val priceMap: StateFlow<Map<String, Double>> = _priceMap.asStateFlow()

    private val _errorMessage   = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _isLoading      = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    // ── 서비스 상태 수신 ───────────────────────────────
    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val posCount    = intent?.getIntExtra("positions_count", 0) ?: 0
            val dailyProfit = intent?.getDoubleExtra("daily_profit", 0.0) ?: 0.0
            val balance     = intent?.getDoubleExtra("balance", 0.0) ?: 0.0
            val statusStr   = intent?.getStringExtra("status") ?: "STOPPED"

            _botState.value = _botState.value.copy(
                status         = BotStatus.valueOf(statusStr),
                availableBalance = balance,
                dailyProfitKrw = dailyProfit
            )
        }
    }

    // ── 가격 자동 갱신 (10초 주기) ────────────────────
    private var priceUpdateJob: Job? = null

    init {
        loadSettings()
        registerBroadcastReceiver()
        startPriceUpdates()
    }

    private fun loadSettings() {
        _settings.value = settingsManager.getSettings()
    }

    private fun registerBroadcastReceiver() {
        val filter = IntentFilter(TradingService.BROADCAST_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getApplication<Application>().registerReceiver(stateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            getApplication<Application>().registerReceiver(stateReceiver, filter)
        }
    }

    private fun startPriceUpdates() {
        priceUpdateJob?.cancel()
        priceUpdateJob = viewModelScope.launch {
            while (isActive) {
                updatePrices()
                delay(10_000L)
            }
        }
    }

    private suspend fun updatePrices() {
        val coins = _settings.value.enabledCoins
        if (coins.isEmpty()) return
        try {
            val prices = repository.getMultiplePrices(coins)
            _priceMap.value = prices

            // 포지션 현재가 업데이트
            val updated = _positions.value.map { pos ->
                prices[pos.ticker]?.let { price -> pos.copy(currentPrice = price) } ?: pos
            }
            _positions.value = updated

            // 봇 상태 총 손익 업데이트
            val totalPL = updated.sumOf { it.profitLossKrw }
            val totalPLPct = if (_botState.value.totalInvested > 0)
                totalPL / _botState.value.totalInvested * 100.0 else 0.0

            _botState.value = _botState.value.copy(
                totalProfitLossKrw = totalPL,
                totalProfitLossPct = totalPLPct,
                positions          = updated,
                lastUpdateMs       = System.currentTimeMillis()
            )
        } catch (e: Exception) {
            Timber.e(e, "가격 업데이트 실패")
        }
    }

    // ── 봇 제어 ────────────────────────────────────────

    fun startBot() {
        val settings = _settings.value
        if (settings.tradingMode == TradingMode.LIVE &&
            (settings.upbitAccessKey.isEmpty() || settings.upbitSecretKey.isEmpty())) {
            _errorMessage.value = "실전거래 모드에서는 API 키가 필요합니다"
            return
        }

        val ctx = getApplication<Application>()
        val intent = Intent(ctx, TradingService::class.java).apply {
            action = TradingService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }

        _botState.value = _botState.value.copy(status = BotStatus.RUNNING)
        Timber.d("봇 시작 요청")
    }

    fun stopBot() {
        val ctx = getApplication<Application>()
        ctx.startService(Intent(ctx, TradingService::class.java).apply {
            action = TradingService.ACTION_STOP
        })
        _botState.value = _botState.value.copy(status = BotStatus.STOPPED)
        Timber.d("봇 중지 요청")
    }

    fun pauseBot() {
        val ctx = getApplication<Application>()
        ctx.startService(Intent(ctx, TradingService::class.java).apply {
            action = TradingService.ACTION_PAUSE
        })
        _botState.value = _botState.value.copy(status = BotStatus.PAUSED)
    }

    // ── 설정 저장 ──────────────────────────────────────

    fun saveSettings(newSettings: AppSettings) {
        settingsManager.saveSettings(newSettings)
        _settings.value = newSettings
        repository.setApiKeys(newSettings.upbitAccessKey, newSettings.upbitSecretKey)
    }

    // ── API 키 검증 ────────────────────────────────────

    fun validateApiKeys(accessKey: String, secretKey: String, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                repository.setApiKeys(accessKey, secretKey)
                val accounts = repository.getAccounts()
                if (accounts.isNotEmpty()) {
                    val krw = accounts.firstOrNull { it.currency == "KRW" }
                    val balance = krw?.balance ?: 0.0
                    onResult(true, "연결 성공! KRW 잔고: ${NumberFormat.getNumberInstance(Locale.KOREA).format(balance.toLong())}원")
                } else {
                    onResult(false, "API 키 오류: 계좌 정보를 가져올 수 없습니다")
                }
            } catch (e: Exception) {
                onResult(false, "연결 실패: ${e.message}")
            } finally {
                _isLoading.value = false
            }
        }
    }

    // ── 현재가 단순 조회 ───────────────────────────────

    fun fetchCurrentPrice(ticker: String, onResult: (Double?) -> Unit) {
        viewModelScope.launch {
            onResult(repository.getCurrentPrice(ticker))
        }
    }

    // ── 오류 메시지 초기화 ─────────────────────────────

    fun clearError() { _errorMessage.value = null }

    // ── 전략 목록 ──────────────────────────────────────

    fun getAllStrategyConfigs(): List<StrategyConfig> = StrategyFactory.getAllConfigs()

    override fun onCleared() {
        super.onCleared()
        try { getApplication<Application>().unregisterReceiver(stateReceiver) } catch (_: Exception) {}
        priceUpdateJob?.cancel()
    }
}
