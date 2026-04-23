#!/bin/bash
# =====================================================
# AutoProfitBot Android APK 빌드 스크립트
# =====================================================

set -e

echo "======================================"
echo "  AutoProfitBot APK 빌드 시작"
echo "======================================"

# Java 17 확인
if ! command -v java &> /dev/null; then
    echo "❌ Java가 설치되지 않았습니다."
    echo "   설치: sudo apt install openjdk-17-jdk"
    exit 1
fi

JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d'.' -f1)
echo "✅ Java 버전: $JAVA_VER"

# Android SDK 확인
if [ -z "$ANDROID_HOME" ]; then
    # 일반적인 위치 탐색
    if [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
    elif [ -d "/opt/android-sdk" ]; then
        export ANDROID_HOME="/opt/android-sdk"
    else
        echo "⚠️  ANDROID_HOME 미설정 - Android Studio로 빌드하세요"
        echo "   또는: export ANDROID_HOME=/path/to/android-sdk"
    fi
fi

echo "📦 Android SDK: ${ANDROID_HOME:-미설정}"

# Gradle 래퍼로 빌드
echo ""
echo "🔨 Debug APK 빌드 중..."
chmod +x gradlew
./gradlew assembleDebug --no-daemon --stacktrace

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo ""
    echo "======================================"
    echo "  ✅ 빌드 성공!"
    echo "  📱 APK 위치: $APK_PATH"
    echo "  📦 파일 크기: $SIZE"
    echo "======================================"
    echo ""
    echo "📲 설치 방법:"
    echo "  1. USB 디버깅 활성화 후: adb install $APK_PATH"
    echo "  2. 또는 APK 파일을 폰으로 전송 후 설치"
else
    echo "❌ APK 빌드 실패 - 로그를 확인하세요"
    exit 1
fi
