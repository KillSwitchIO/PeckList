package com.pecklist.app;

/**
 * Which of the two builds this is (docs/development/android.md, Two builds), from its Gradle flavor:
 * {@code foss}, the APK on the GitLab releases (and F-Droid's), or {@code play}, the Google Play
 * bundle. Both have the same app ID and key, so either installs over the other. The Play build
 * follows Google Play's rules: it holds neither USE_EXACT_ALARM nor
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, and opens no payment links ({@link PaymentLinks}). The web
 * app hears which it is from {@code info().distribution}; a web app that does not ask behaves as foss.
 */
final class Distribution {

    static final String FOSS = "foss";
    static final String PLAY = "play";

    /** This build's. */
    static final String NAME = BuildConfig.FLAVOR;

    private Distribution() {}

    static boolean isPlay() {
        return PLAY.equals(NAME);
    }
}
