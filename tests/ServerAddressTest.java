import app.nightcity.crew.ServerAddress;

/** Pure Java adversarial URL checks; no Android runtime or test framework required. */
public final class ServerAddressTest {
    private static int checks;

    private static void equal(String actual, String expected) {
        checks++;
        if (!expected.equals(actual)) {
            throw new AssertionError("Expected " + expected + ", received " + actual);
        }
    }

    private static void normalize(String input, String expected) {
        equal(ServerAddress.normalize(input), expected);
    }

    private static void reject(String input) {
        checks++;
        try {
            ServerAddress.normalize(input);
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError("Unsafe server address accepted: " + input);
    }

    private static void same(String candidate, String accepted, boolean expected) {
        checks++;
        if (ServerAddress.sameOrigin(candidate, accepted) != expected) {
            throw new AssertionError("Incorrect origin comparison: " + candidate + " / " + accepted);
        }
    }

    private static void local(String host, boolean expected) {
        checks++;
        if (ServerAddress.isPrivateIpv4(host) != expected) {
            throw new AssertionError("Incorrect private IPv4 classification: " + host);
        }
    }

    public static void main(String[] args) {
        normalize(" 192.168.1.5:8080 ", "http://192.168.1.5:8080");
        normalize("HTTP://192.168.1.5:80/", "http://192.168.1.5");
        normalize("http://localhost:8080/", "http://localhost:8080");
        normalize("http://LOCALHOST", "http://localhost");
        normalize("http://127.0.0.1:8080", "http://127.0.0.1:8080");
        normalize("https://SERVER.Example:443/", "https://server.example");
        normalize("https://server.example:8443", "https://server.example:8443");
        normalize("https://xn--e1afmkfd.xn--p1ai", "https://xn--e1afmkfd.xn--p1ai");

        for (String host : new String[] {"10.0.0.1", "10.255.255.255", "127.0.0.1",
                "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.2.3"}) {
            local(host, true);
            normalize("http://" + host, "http://" + host);
        }
        for (String host : new String[] {"0.0.0.0", "1.1.1.1", "172.15.255.255", "172.32.0.1",
                "192.169.0.1", "169.255.0.1", "224.0.0.1", "255.255.255.255", "10.0.0.256",
                "10.0.0.-1", "010.0.0.1", "127.1", "2130706433", "0x7f000001", "192.168.1.1.",
                "127.000.0.1", "10.0.0.1.attacker.example", "192.168.1.1@example.com"}) {
            local(host, false);
            reject("http://" + host);
        }
        for (String input : new String[] {null, "", "  ", "http://", "https://",
                "file:///data/data/app.nightcity.crew/files/host-data/tracker.sqlite3",
                "javascript://192.168.1.1", "data://192.168.1.1", "ftp://192.168.1.1",
                "http://public.example", "http://[::1]", "http://[fd00::1]",
                "https://user:password@server.example", "http://user@127.0.0.1",
                "https://server.example@attacker.example", "https://server.example/a",
                "http://192.168.1.1/api", "http://192.168.1.1//", "https://server.example/?token=x",
                "https://server.example#token", "https://server.example:0", "http://127.0.0.1:65536",
                "http://127.0.0.1:-2", "https://server.example\\@attacker.example",
                "https://server.example\n.attacker.example", "http://localhost.attacker.example"}) {
            reject(input);
        }

        same("https://SERVER.EXAMPLE:443/page?x=1#part", "https://server.example", true);
        same("https://server.example/path", "https://server.example/other", true);
        same("http://192.168.1.1:8080/api/me", "http://192.168.1.1:8080", true);
        same("http://127.0.0.1:80/", "http://127.0.0.1", true);
        same("https://server.example:8443", "https://server.example", false);
        same("http://server.example", "https://server.example", false);
        same("https://server.example.attacker.example", "https://server.example", false);
        same("https://user@server.example", "https://server.example", false);
        same("https://server.example@attacker.example", "https://server.example", false);
        same("https://server.example.", "https://server.example", false);
        same("http://127.0.0.1:8080", "http://192.168.1.1:8080", false);
        same("http://127.0.0.1:8081", "http://127.0.0.1:8080", false);
        same("file:///data/data/app.nightcity.crew", "http://127.0.0.1:8080", false);
        same("javascript:alert(1)", "https://server.example", false);
        same("data:text/html,hello", "https://server.example", false);
        same("blob:https://server.example/id", "https://server.example", false);
        same("not a URL", "not a URL", false);
        same("", "", false);
        equal(ServerAddress.origin("file:///private/data"), "");
        equal(ServerAddress.origin("https://username:password@server.example/"), "");
        System.out.println("ServerAddress: " + checks + " adversarial and normalization checks passed.");
    }
}
