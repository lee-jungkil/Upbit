package com.autoprofit.bot.api

import retrofit2.Response
import retrofit2.http.*

// =============================================
// Upbit REST API 인터페이스
// =============================================
interface UpbitApiService {

    // 마켓 코드 조회
    @GET("v1/market/all")
    suspend fun getMarketAll(
        @Query("isDetails") isDetails: Boolean = false
    ): Response<List<MarketDto>>

    // 현재가 조회 (복수)
    @GET("v1/ticker")
    suspend fun getTicker(
        @Query("markets") markets: String
    ): Response<List<TickerDto>>

    // OHLCV 캔들 (분봉)
    @GET("v1/candles/minutes/{unit}")
    suspend fun getCandlesMinutes(
        @Path("unit") unit: Int,
        @Query("market") market: String,
        @Query("count") count: Int = 200,
        @Query("to") to: String? = null
    ): Response<List<CandleDto>>

    // 호가창 조회
    @GET("v1/orderbook")
    suspend fun getOrderbook(
        @Query("markets") markets: String
    ): Response<List<OrderbookDto>>

    // 체결 내역 조회
    @GET("v1/trades/ticks")
    suspend fun getTrades(
        @Query("market") market: String,
        @Query("count") count: Int = 100
    ): Response<List<TradeDto>>

    // ── 인증 필요 엔드포인트 ──────────────────────────

    // 잔고 조회
    @GET("v1/accounts")
    suspend fun getAccounts(
        @Header("Authorization") authorization: String
    ): Response<List<AccountDto>>

    // 주문 목록 조회
    @GET("v1/orders")
    suspend fun getOrders(
        @Header("Authorization") authorization: String,
        @Query("state") state: String = "wait",
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Response<List<OrderDto>>

    // 시장가 매수 주문
    @POST("v1/orders")
    suspend fun placeBuyOrder(
        @Header("Authorization") authorization: String,
        @Body body: BuyOrderRequest
    ): Response<OrderResultDto>

    // 시장가 매도 주문
    @POST("v1/orders")
    suspend fun placeSellOrder(
        @Header("Authorization") authorization: String,
        @Body body: SellOrderRequest
    ): Response<OrderResultDto>

    // 지정가 주문
    @POST("v1/orders")
    suspend fun placeLimitOrder(
        @Header("Authorization") authorization: String,
        @Body body: LimitOrderRequest
    ): Response<OrderResultDto>

    // 주문 취소
    @DELETE("v1/order")
    suspend fun cancelOrder(
        @Header("Authorization") authorization: String,
        @Query("uuid") uuid: String
    ): Response<OrderResultDto>

    // 개별 주문 조회
    @GET("v1/order")
    suspend fun getOrder(
        @Header("Authorization") authorization: String,
        @Query("uuid") uuid: String
    ): Response<OrderResultDto>
}

// =============================================
// DTO 데이터 클래스
// =============================================
data class MarketDto(
    val market: String,
    val korean_name: String,
    val english_name: String
)

data class TickerDto(
    val market: String,
    val trade_price: Double,
    val prev_closing_price: Double,
    val change_rate: Double,
    val acc_trade_volume_24h: Double,
    val acc_trade_price_24h: Double,
    val high_price: Double,
    val low_price: Double,
    val opening_price: Double,
    val signed_change_rate: Double,
    val signed_change_price: Double,
    val trade_volume: Double,
    val timestamp: Long
)

data class CandleDto(
    val market: String,
    val candle_date_time_kst: String,
    val opening_price: Double,
    val high_price: Double,
    val low_price: Double,
    val trade_price: Double,
    val candle_acc_trade_volume: Double,
    val candle_acc_trade_price: Double,
    val timestamp: Long,
    val unit: Int? = null
)

data class OrderbookDto(
    val market: String,
    val timestamp: Long,
    val total_ask_size: Double,
    val total_bid_size: Double,
    val orderbook_units: List<OrderbookUnit>
)

data class OrderbookUnit(
    val ask_price: Double,
    val bid_price: Double,
    val ask_size: Double,
    val bid_size: Double
)

data class TradeDto(
    val market: String,
    val trade_date_utc: String,
    val trade_time_utc: String,
    val timestamp: Long,
    val trade_price: Double,
    val trade_volume: Double,
    val ask_bid: String,
    val sequential_id: Long
)

data class AccountDto(
    val currency: String,
    val balance: String,
    val locked: String,
    val avg_buy_price: String,
    val avg_buy_price_modified: Boolean,
    val unit_currency: String
)

data class OrderDto(
    val uuid: String,
    val side: String,
    val market: String,
    val price: String?,
    val volume: String?,
    val remaining_volume: String?,
    val executed_volume: String?,
    val state: String,
    val created_at: String,
    val ord_type: String,
    val paid_fee: String?,
    val locked: String?,
    val trades_count: Int?
)

data class OrderResultDto(
    val uuid: String,
    val side: String,
    val market: String,
    val price: String?,
    val volume: String?,
    val remaining_volume: String?,
    val executed_volume: String?,
    val state: String,
    val created_at: String,
    val ord_type: String,
    val paid_fee: String?,
    val reserved_fee: String?,
    val remaining_fee: String?,
    val locked: String?,
    val trades_count: Int?
)

// 주문 요청 바디
data class BuyOrderRequest(
    val market: String,
    val side: String = "bid",
    val price: String,          // 매수 금액 (KRW)
    val ord_type: String = "price"   // 시장가 매수
)

data class SellOrderRequest(
    val market: String,
    val side: String = "ask",
    val volume: String,         // 매도 수량
    val ord_type: String = "market"  // 시장가 매도
)

data class LimitOrderRequest(
    val market: String,
    val side: String,           // bid(매수) / ask(매도)
    val price: String,          // 지정가
    val volume: String,         // 수량
    val ord_type: String = "limit"
)
