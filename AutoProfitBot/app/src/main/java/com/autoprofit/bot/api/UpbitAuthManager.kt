package com.autoprofit.bot.api

import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Upbit API JWT 인증 토큰 생성기
 * - 시장가/지정가 주문, 잔고 조회 등 인증 필요 API에 사용
 */
@Singleton
class UpbitAuthManager @Inject constructor() {

    /**
     * 기본 JWT 토큰 생성 (파라미터 없는 요청용)
     */
    fun generateToken(accessKey: String, secretKey: String): String {
        val payload = mapOf(
            "access_key" to accessKey,
            "nonce"      to UUID.randomUUID().toString()
        )
        return buildJwt(secretKey, payload)
    }

    /**
     * 쿼리 파라미터 포함 JWT 토큰 생성
     * (주문 조회, 취소 등 query string 포함 요청)
     */
    fun generateTokenWithQuery(
        accessKey: String,
        secretKey: String,
        queryString: String
    ): String {
        val queryHash = sha512(queryString)
        val payload = mapOf(
            "access_key"        to accessKey,
            "nonce"             to UUID.randomUUID().toString(),
            "query_hash"        to queryHash,
            "query_hash_alg"    to "SHA512"
        )
        return buildJwt(secretKey, payload)
    }

    /**
     * 주문 요청용 JWT 토큰 생성
     */
    fun generateOrderToken(
        accessKey: String,
        secretKey: String,
        market: String,
        side: String,
        volume: String? = null,
        price: String? = null,
        ordType: String
    ): String {
        val params = buildString {
            append("market=$market&side=$side&ord_type=$ordType")
            if (volume != null) append("&volume=$volume")
            if (price != null)  append("&price=$price")
        }
        return generateTokenWithQuery(accessKey, secretKey, params)
    }

    private fun buildJwt(secretKey: String, payload: Map<String, String>): String {
        val keyBytes = secretKey.toByteArray(StandardCharsets.UTF_8)
        val key = Keys.hmacShaKeyFor(keyBytes)

        val builder = Jwts.builder().header().add("alg", "HS256").and()

        payload.forEach { (k, v) -> builder.claim(k, v) }

        return "Bearer " + builder.signWith(key).compact()
    }

    private fun sha512(input: String): String {
        val digest = MessageDigest.getInstance("SHA-512")
        val hash = digest.digest(input.toByteArray(StandardCharsets.UTF_8))
        return hash.joinToString("") { "%02x".format(it) }
    }
}
