package com.pecklist.app;

import java.util.Locale;

/**
 * Pages to donate or pay on: every link in web/src/app/support/links.ts, and the supporter key
 * page. Google Play lets an app take money only through Play, so the Play build opens none of them
 * ({@link ShellWebViewClient}) and quietly does nothing instead. The web app hides them in the Play
 * build; this is the backstop for a server whose web app is older and still shows them.
 * PaymentLinksTest checks that every address in links.ts and the supporter key page is caught.
 */
final class PaymentLinks {

    /** Sites that are only for paying, with every subdomain. Add a new donation platform here too. */
    private static final String[] SITES = {"ko-fi.com", "paypal.com", "paypal.me", "paddle.com", "paddle.io"};

    /** The project's own site, where only the support pages sell (supporter keys, donations). */
    private static final String[] PROJECT_HOSTS = {"pecklist.com", "www.pecklist.com"};

    private static final String SUPPORT = "/support";

    private PaymentLinks() {}

    /**
     * Whether a link is to a page to pay on: parts as Android's Uri gives them, the path decoded.
     * Only web addresses are; anything else is someone else's business.
     */
    static boolean isPayment(String scheme, String host, String path) {
        if (scheme == null || host == null) return false;
        String lowScheme = scheme.toLowerCase(Locale.ROOT);
        if (!lowScheme.equals("https") && !lowScheme.equals("http")) return false;
        String name = host.toLowerCase(Locale.ROOT);
        // "ko-fi.com." is the same site.
        if (name.endsWith(".")) name = name.substring(0, name.length() - 1);
        for (String site : SITES) {
            if (name.equals(site) || name.endsWith("." + site)) return true;
        }
        for (String project : PROJECT_HOSTS) {
            if (!name.equals(project)) continue;
            // As a web server may read it: "//support" and "/support;x" or "/support.html" too.
            String page = path == null ? "" : path.toLowerCase(Locale.ROOT).replaceAll("/{2,}", "/");
            if (!page.startsWith(SUPPORT)) return false;
            String rest = page.substring(SUPPORT.length());
            return rest.isEmpty() || rest.charAt(0) == '/' || rest.charAt(0) == '.' || rest.charAt(0) == ';';
        }
        return false;
    }

    /** Whether this build refuses to open it: never in the foss build, a payment link in the Play one. */
    static boolean blocked(boolean play, String scheme, String host, String path) {
        return play && isPayment(scheme, host, path);
    }
}
