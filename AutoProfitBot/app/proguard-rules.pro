# Add project specific ProGuard rules here.
# Retrofit
-keepattributes Signature
-keepattributes Exceptions
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keep class okhttp3.** { *; }
-keep class com.autoprofit.bot.api.** { *; }
-keep class com.autoprofit.bot.trading.models.** { *; }
# JJWT
-keep class io.jsonwebtoken.** { *; }
# Room
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
# Hilt
-keep class dagger.hilt.** { *; }
-keep @dagger.hilt.android.AndroidEntryPoint class * { *; }
