package com.pecklist.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

public class PaymentLinksTest {

    private static boolean payment(String url) {
        URI uri = URI.create(url);
        return PaymentLinks.isPayment(uri.getScheme(), uri.getHost(), uri.getPath());
    }

    @Test
    public void donationSitesAndTheSupporterKeyPageArePayments() {
        assertTrue(payment("https://ko-fi.com/S6S7P3FVW"));
        assertTrue(payment("https://www.ko-fi.com/"));
        assertTrue(payment("https://KO-FI.COM./x"));
        assertTrue(payment("https://www.paypal.com/donate"));
        // The PayPal button 0.12.1 adds to links.ts, whatever server web app shows it.
        assertTrue(payment("https://www.paypal.com/donate/?hosted_button_id=NF3EZPGC3NL86"));
        assertTrue(payment("https://paypal.com/donate/"));
        assertTrue(payment("https://paypal.me/x"));
        assertTrue(payment("https://buy.paddle.com/checkout"));
        assertTrue(payment("https://pecklist.com/support"));
        assertTrue(payment("https://pecklist.com/support/"));
        assertTrue(payment("https://www.pecklist.com/Support/keys?from=app"));
        assertTrue(payment("http://pecklist.com/support"));
        // Other spellings a web server may serve as the same page (security review, Low 1).
        assertTrue(payment("https://pecklist.com//support"));
        assertTrue(payment("https://pecklist.com/support;jsessionid=1"));
        assertTrue(payment("https://pecklist.com/support.html"));
    }

    @Test
    public void everythingElseOpensAsBefore() {
        // The rest of the project's site and its docs.
        assertFalse(payment("https://pecklist.com/"));
        assertFalse(payment("https://pecklist.com/supporters-faq"));
        assertFalse(payment("https://docs.pecklist.com/support/"));
        assertFalse(payment("https://selfhosted.pecklist.com/"));
        // A site whose name only ends like one.
        assertFalse(payment("https://notko-fi.com/"));
        assertFalse(payment("https://ko-fi.com.example.com/"));
        assertFalse(payment("https://gitlab.com/"));
        // Not a web page.
        assertFalse(PaymentLinks.isPayment("mailto", null, null));
        assertFalse(PaymentLinks.isPayment("intent", "ko-fi.com", "/"));
        assertFalse(PaymentLinks.isPayment(null, null, null));
    }

    @Test
    public void onlyThePlayBuildRefusesThem() {
        assertTrue(PaymentLinks.blocked(true, "https", "ko-fi.com", "/S6S7P3FVW"));
        assertFalse(PaymentLinks.blocked(false, "https", "ko-fi.com", "/S6S7P3FVW"));
        assertFalse(PaymentLinks.blocked(true, "https", "docs.pecklist.com", "/"));
    }

    /**
     * Every address in the web app's support code (links.ts, the supporter key page) is caught, so a
     * new donation platform added there cannot slip past the Play build: add its site to PaymentLinks.
     */
    @Test
    public void everyLinkInTheWebAppsSupportCodeIsCaught() throws IOException {
        File support = new File("../../../web/src/app/support");
        assertTrue("web/src/app/support from " + new File(".").getAbsolutePath(), support.isDirectory());
        Pattern address = Pattern.compile("https?://[^'\"`\\s)]+");
        List<String> found = new ArrayList<>();
        for (File file : support.listFiles()) {
            String name = file.getName();
            if (name.contains(".test.") || !(name.endsWith(".ts") || name.endsWith(".tsx"))) continue;
            Matcher matcher = address.matcher(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
            while (matcher.find()) found.add(matcher.group());
        }
        assertTrue("links.ts has at least the Ko-fi link", found.contains("https://ko-fi.com/S6S7P3FVW"));
        for (String url : found) assertTrue(url + " is not caught by PaymentLinks", payment(url));
    }
}
