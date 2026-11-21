package com.pecklist.app;

import android.content.Context;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * Which app installed this one, as Android recorded it: an app store (F-Droid, Google Play), the
 * system's package installer for a downloaded APK, or the shell for {@code adb install}. The web
 * app hears it from {@code info().installer} and {@code info().installRequestedBy}, and leaves
 * updates to an F-Droid client that installed it, as it leaves them to Google Play in the Play build
 * (VersionStatus.tsx).
 *
 * <p>A store that installs through a session (F-Droid, or its privileged extension) is the installing
 * package itself. One that hands the APK to the system's installer instead ({@code
 * ACTION_INSTALL_PACKAGE}) leaves that installer as the installing package, and Android 11 and later
 * keep the store as the initiating one (Dev 1's review), so both are passed on.
 */
final class Installer {

    private Installer() {}

    /** The installing package's name, or null when Android doesn't say. */
    static String of(Context context) {
        PackageManager packages = context.getPackageManager();
        String self = context.getPackageName();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return packages.getInstallSourceInfo(self).getInstallingPackageName();
            }
            return installerBeforeR(packages, self);
        } catch (PackageManager.NameNotFoundException | RuntimeException error) {
            return null;
        }
    }

    /**
     * The app that asked for the install (Android 11 and later), which differs from {@link #of} when a
     * store went through the system's installer; null before Android 11 or when Android doesn't say.
     */
    static String requestedBy(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        try {
            InstallSourceInfo source = context.getPackageManager().getInstallSourceInfo(context.getPackageName());
            return source.getInitiatingPackageName();
        } catch (PackageManager.NameNotFoundException | RuntimeException error) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private static String installerBeforeR(PackageManager packages, String self) {
        return packages.getInstallerPackageName(self);
    }
}
