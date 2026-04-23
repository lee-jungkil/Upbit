package com.autoprofit.bot.api

import com.autoprofit.bot.trading.models.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UpbitRepository @Inject constructor(
    private val apiService: UpbitApiService,
    private val authManager: UpbitAuthManager
) {
    private var accessKey: String = ""
    private var secretKey: String = ""

    fun setApiKeys(access: String, secret: String) {
        accessKey = access
        secretKey = secret
    }

    fun hasApiKeys() = accessKey.isNotEmpty() && secretKey.isNotEmpty()

    // ── 공개 API ─────────────────────────────────────

    suspend fun getCurrentPrice(market: String): Double? = withContext(Dispatchers.IO) {
        try {
            val resp = apiService.getTicker(market)
            if (resp.isSuccessful) resp.body()?.firstOrNull()?.trade_price
            else { Timber.e("getCurrentPrice 실패: ${resp.code()}"); null }
        } catch (e: Exception) {
            Timber.e(e, "getCurrentPrice 예외: $market"); null
        }
    }

    suspend fun getMultiplePrices(markets: List<String>): Map<String, Double> = withContext(Dispatchers.IO) {
        try {
            val resp = apiService.getTicker(markets.joinToString(","))
            if (resp.isSuccessful) {
                resp.body()?.associate { it.market to it.trade_price } ?: emptyMap()
            } else emptyMap()
        } catch (e: Exception) {
            Timber.e(e, "getMultiplePrices 예외"); emptyMap()
        }
    }

    suspend fun getCandles(market: String, unit: Int = 5, count: Int = 200): List<Candle> = withContext(Dispatchers.IO) {
        try {
            val resp = apiService.getCandlesMinutes(unit, market, count)
            if (resp.isSuccessful) {
                resp.body()?.reversed()?.map { dto ->
                    Candle(
                        market      = dto.market,
                        timestamp   = dto.timestamp,
                        open        = dto.opening_price,
                        high        = dto.high_price,
                        low         = dto.low_price,
                        close       = dto.trade_price,
                        volume      = dto.candle_acc_trade_volume,
                        dateTimeKst = dto.candle_date_time_kst
                    )
                } ?: emptyList()
            } else emptyList()
        } catch (e: Exception) {
            Timber.e(e, "getCandles 예외: $market"); emptyList()
        }
    }

    suspend fun getOrderbook(market: String): OrderbookData? = withContext(Dispatchers.IO) {
        try {
            val resp = apiService.getOrderbook(market)
            if (resp.isSuccessful) {
                resp.body()?.firstOrNull()?.let { dto ->
                    OrderbookData(
                        market       = dto.market,
                        totalAskSize = dto.total_ask_size,
                        totalBidSize = dto.total_bid_size,
                        units        = dto.orderbook_units.map { u ->
                            OrderbookUnit(u.ask_price, u.bid_price, u.ask_size, u.bid_size)
                        }
                    )
                }
            } else null
        } catch (e: Exception) {
            Timber.e(e, "getOrderbook 예외: $market"); null
        }
    }

    suspend fun getRecentTrades(market: String, count: Int = 100): List<TradeData> = withContext(Dispatchers.IO) {
        try {
            val resp = apiService.getTrades(market, count)
            if (resp.isSuccessful) {
                resp.body()?.map { dto ->
                    TradeData(
                        market    = dto.market,
                        price     = dto.trade_price,
                        volume    = dto.trade_volume,
                        askBid    = dto.ask_bid,
                        timestamp = dto.timestamp
                    )
                } ?: emptyList()
            } else emptyList()
        } catch (e: Exception) {
            Timber.e(e, "getRecentTrades 예외: $market"); emptyList()
        }
    }

    suspend fun getKrwMarkets(): List<String> = withContext(Dispatchers.IO) {
        try {
            val resp = apiService.getMarketAll()
            if (resp.isSuccessful) {
                resp.body()?.filter { it.market.startsWith("KRW-") }?.map { it.market } ?: emptyList()
            } else emptyList()
        } catch (e: Exception) {
            Timber.e(e, "getKrwMarkets 예외"); emptyList()
        }
    }

    // ── 인증 필요 API ────────────────────────────────

    suspend fun getAccounts(): List<AccountInfo> = withContext(Dispatchers.IO) {
        try {
            val token = authManager.generateToken(accessKey, secretKey)
            val resp  = apiService.getAccounts(token)
            if (resp.isSuccessful) {
                resp.body()?.map { dto ->
                    AccountInfo(
                        currency       = dto.currency,
                        balance        = dto.balance.toDoubleOrNull() ?: 0.0,
                        locked         = dto.locked.toDoubleOrNull() ?: 0.0,
                        avgBuyPrice    = dto.avg_buy_price.toDoubleOrNull() ?: 0.0,
                        unitCurrency   = dto.unit_currency
                    )
                } ?: emptyList()
            } else {
                Timber.e("getAccounts 실패: ${resp.code()} ${resp.errorBody()?.string()}")
                emptyList()
            }
        } catch (e: Exception) {
            Timber.e(e, "getAccounts 예외"); emptyList()
        }
    }

    suspend fun getKrwBalance(): Double {
        return getAccounts().firstOrNull { it.currency == "KRW" }?.balance ?: 0.0
    }

    suspend fun placeBuyOrder(market: String, priceKrw: Double): OrderResult? = withContext(Dispatchers.IO) {
        try {
            val token = authManager.generateOrderToken(
                accessKey, secretKey, market, "bid",
                price = priceKrw.toLong().toString(), ordType = "price"
            )
            val body = BuyOrderRequest(market = market, price = priceKrw.toLong().toString())
            val resp = apiService.placeBuyOrder(token, body)
            if (resp.isSuccessful) {
                resp.body()?.let { dto ->
                    OrderResult(
                        uuid            = dto.uuid,
                        side            = dto.side,
                        market          = dto.market,
                        price           = dto.price?.toDoubleOrNull(),
                        volume          = dto.volume?.toDoubleOrNull(),
                        executedVolume  = dto.executed_volume?.toDoubleOrNull(),
                        state           = dto.state,
                        createdAt       = dto.created_at,
                        paidFee         = dto.paid_fee?.toDoubleOrNull(),
                        success         = true
                    )
                }
            } else {
                Timber.e("placeBuyOrder 실패: ${resp.code()} ${resp.errorBody()?.string()}")
                null
            }
        } catch (e: Exception) {
            Timber.e(e, "placeBuyOrder 예외: $market"); null
        }
    }

    suspend fun placeSellOrder(market: String, volume: Double): OrderResult? = withContext(Dispatchers.IO) {
        try {
            val token = authManager.generateOrderToken(
                accessKey, secretKey, market, "ask",
                volume = volume.toString(), ordType = "market"
            )
            val body = SellOrderRequest(market = market, volume = volume.toString())
            val resp = apiService.placeSellOrder(token, body)
            if (resp.isSuccessful) {
                resp.body()?.let { dto ->
                    OrderResult(
                        uuid           = dto.uuid,
                        side           = dto.side,
                        market         = dto.market,
                        price          = dto.price?.toDoubleOrNull(),
                        volume         = dto.volume?.toDoubleOrNull(),
                        executedVolume = dto.executed_volume?.toDoubleOrNull(),
                        state          = dto.state,
                        createdAt      = dto.created_at,
                        paidFee        = dto.paid_fee?.toDoubleOrNull(),
                        success        = true
                    )
                }
            } else {
                Timber.e("placeSellOrder 실패: ${resp.code()} ${resp.errorBody()?.string()}")
                null
            }
        } catch (e: Exception) {
            Timber.e(e, "placeSellOrder 예외: $market"); null
        }
    }
}
