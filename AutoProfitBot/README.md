# 🤖 AutoProfitBot Android

**Upbit 자동매매 봇 - 안드로이드 앱 버전**
> Python `main.py` (v6.30.62) → Android Kotlin 완전 포팅

---

## 📱 앱 특징

| 기능 | 설명 |
|------|------|
| 🔄 **백그라운드 자동매매** | 앱 종료 후에도 ForegroundService로 24시간 실행 |
| 🔔 **실시간 푸시 알림** | 매수/매도/손절/익절/일일요약 알림 |
| 📊 **실시간 대시보드** | 포지션, 잔고, 수익률 실시간 모니터링 |
| ⚡ **5가지 전략** | 공격적·보수적 스캘핑, 평균회귀, 그리드, 초단타 |
| 🛡 **리스크 관리** | 손절/익절/트레일링스탑/시간초과 자동 청산 |
| 🎮 **모의·실전 거래** | 모의거래로 안전하게 테스트 후 실전 전환 |
| 📲 **부팅 자동시작** | 폰 재부팅 후에도 자동으로 봇 재개 |

---

## 🏗 프로젝트 구조

```
AutoProfitBot/
├── app/src/main/
│   ├── java/com/autoprofit/bot/
│   │   ├── MainActivity.kt              # 메인 액티비티 (하단 네비게이션)
│   │   ├── AutoProfitApplication.kt     # 앱 초기화 & 알림 채널 생성
│   │   ├── api/
│   │   │   ├── UpbitApiService.kt       # Retrofit API 인터페이스 (전체 엔드포인트)
│   │   │   ├── UpbitAuthManager.kt      # JWT 인증 토큰 생성 (HMAC-SHA512)
│   │   │   └── UpbitRepository.kt       # API 호출 추상화 레이어
│   │   ├── service/
│   │   │   ├── TradingService.kt        # ★ 핵심: 백그라운드 ForegroundService
│   │   │   └── BootReceiver.kt          # 부팅 완료 시 자동 시작
│   │   ├── trading/
│   │   │   ├── models/TradingModels.kt  # 데이터 모델 (Position, BotState 등)
│   │   │   └── strategies/
│   │   │       ├── TechnicalIndicatorEngine.kt  # RSI/MACD/볼린저밴드/EMA 계산
│   │   │       └── TradingStrategies.kt         # 5가지 전략 구현
│   │   ├── utils/
│   │   │   ├── NotificationHelper.kt    # 푸시 알림 전송
│   │   │   └── SettingsManager.kt       # 설정 저장/로드 (SharedPreferences)
│   │   ├── viewmodel/
│   │   │   └── TradingViewModel.kt      # UI ↔ Service 연결 ViewModel
│   │   ├── ui/
│   │   │   ├── screens/
│   │   │   │   ├── DashboardScreen.kt   # 메인 대시보드
│   │   │   │   ├── PositionsScreen.kt   # 보유 포지션 상세
│   │   │   │   ├── HistoryScreen.kt     # 거래 기록
│   │   │   │   └── SettingsScreen.kt    # 설정 화면
│   │   │   └── theme/Theme.kt           # 다크 테마 색상 팔레트
│   │   ├── di/AppModule.kt              # Hilt 의존성 주입
│   │   └── ...
│   ├── AndroidManifest.xml
│   └── res/
├── app/build.gradle
├── build.gradle
└── settings.gradle
```

---

## ⚙️ 기술 스택

| 분류 | 기술 |
|------|------|
| **언어** | Kotlin 1.9 |
| **UI** | Jetpack Compose + Material3 |
| **아키텍처** | MVVM + Clean Architecture |
| **DI** | Hilt (Dagger) |
| **네트워크** | Retrofit2 + OkHttp3 |
| **인증** | JJWT (JWT/HMAC-SHA512) |
| **비동기** | Kotlin Coroutines + Flow |
| **DB** | Room (거래 기록) |
| **저장소** | DataStore + SharedPreferences |
| **백그라운드** | ForegroundService + WakeLock |
| **알림** | NotificationManager (5채널) |

---

## 🔔 알림 채널

| 채널 | 내용 | 우선순위 |
|------|------|---------|
| 자동매매 실행 중 | 포그라운드 상태 알림 (상시) | LOW |
| 매수 알림 | 코인 매수 체결 시 | HIGH |
| 매도 알림 | 매도 체결 (익절/손절 포함) | HIGH |
| 손익 요약 | 일일 거래 결과 요약 | DEFAULT |
| 경고 알림 | 손절/리스크 경고/오류 | HIGH |

---

## 📈 거래 전략

### 1. ⚡ 공격적 스캘핑
- 익절: **+1.5%** / 손절: **-1.0%** / 최대 보유: **4분**
- RSI < 30 + MACD 골든크로스 + 볼린저 하단 조건

### 2. 🛡 보수적 스캘핑
- 익절: **+2.0%** / 손절: **-1.5%** / 최대 보유: **8분**
- RSI < 25 + EMA 정배열 + 거래량 확인

### 3. 📊 평균 회귀
- 익절: **+3.0%** / 손절: **-2.0%** / 최대 보유: **30분**
- RSI 과매도 + 볼린저 하단 반등 노림

### 4. 🔲 그리드 트레이딩
- 익절: **+5.0%** / 손절: **-3.0%** / 최대 보유: **60분**
- 볼린저 밴드 4분할 그리드 진입

### 5. 🚀 초단타 스캘핑
- 익절: **+0.8%** / 손절: **-0.5%** / 최대 보유: **3분**
- 거래량 2배+ + 1분 모멘텀 포착

---

## 🔒 청산 조건 (자동)

```
우선순위 순서:
1. 손절가 도달 (Stop Loss)
2. 익절가 도달 (Take Profit)
3. 트레일링 스탑 (수익 실현 후 -1%)
4. 최대 보유 시간 초과
5. 차트 매도 신호 (RSI 과매수/MACD 데드크로스)
```

---

## 🚀 빌드 방법

### 방법 1: Android Studio (권장)
```bash
1. Android Studio 열기
2. File → Open → AutoProfitBot 폴더 선택
3. Build → Generate Signed APK (또는 Run으로 직접 설치)
```

### 방법 2: 커맨드라인
```bash
# Android SDK 및 Java 17 필요
export ANDROID_HOME=/path/to/android-sdk

cd AutoProfitBot
chmod +x gradlew
./gradlew assembleDebug

# APK 위치:
# app/build/outputs/apk/debug/app-debug.apk
```

### 방법 3: 빌드 스크립트
```bash
bash BUILD_APK.sh
```

---

## 📲 설치 방법

### USB 디버깅
```bash
# USB 디버깅 모드 활성화 후
adb install app/build/outputs/apk/debug/app-debug.apk
```

### 직접 설치
```
1. APK 파일을 Google Drive / 카카오톡 으로 폰에 전송
2. 파일 관리자에서 APK 실행
3. "알 수 없는 앱 설치 허용" 선택
4. 설치 완료
```

---

## ⚠️ 사용 전 필수 설정

### 1. 앱 권한 허용
```
✅ 알림 권한 (Android 13+)
✅ 배터리 최적화 제외 (설정 → 앱 → AutoProfitBot → 배터리 → 제한없음)
✅ 백그라운드 앱 실행 허용
```

### 2. 모의거래 테스트 (권장)
```
설정 → 거래 모드 → 모의거래
→ API 키 없이 안전하게 테스트 가능
→ 1~2주 모의거래 후 실전 전환 권장
```

### 3. 실전거래 설정
```
1. Upbit 앱 → 보안 → API 관리 → API 키 발급
2. 권한: 조회O / 거래O / 출금X (안전)
3. IP 화이트리스트 설정 권장
4. AutoProfitBot 설정 → API 키 입력 → 검증
```

---

## 🔋 배터리 최적화 설정 (필수!)

안드로이드의 배터리 절약 기능이 백그라운드 서비스를 강제 종료할 수 있습니다.

```
설정 → 배터리 → 배터리 사용량 → AutoProfitBot
→ "제한 없음" 또는 "최적화 안함" 선택

삼성: 설정 → 디바이스 케어 → 배터리 → 백그라운드 사용 제한 → AutoProfitBot 제외
```

---

## ⚡ 주요 차이점 (Python vs Android)

| 기능 | Python (PC) | Android |
|------|-------------|---------|
| 실행 방식 | 터미널 | 백그라운드 서비스 |
| 화면 표시 | 고정 콘솔 | Jetpack Compose UI |
| 알림 | 텔레그램/Gmail | 안드로이드 푸시 알림 |
| 자동 재시작 | 수동 | 부팅 시 자동 시작 |
| 데이터 저장 | 파일/DB | Room DB + SharedPrefs |
| 전략 수 | 5가지 + 분할전략 | 5가지 핵심 전략 |

---

## ⚠️ 면책 고지

이 소프트웨어는 교육 및 연구 목적으로 제공됩니다.
암호화폐 거래는 높은 위험을 수반합니다.
실제 투자 손실에 대한 책임은 사용자 본인에게 있습니다.
**모의거래로 충분히 테스트 후 실전 거래하세요.**

---

## 📞 지원

- **GitHub**: https://github.com/lee-jungkil/Lj
- **버전**: v6.30.62 Android Port
- **최소 OS**: Android 8.0 (API 26)
- **권장 RAM**: 3GB 이상
