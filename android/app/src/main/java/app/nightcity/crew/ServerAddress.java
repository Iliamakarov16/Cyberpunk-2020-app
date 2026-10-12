package app.nightcity.crew;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** The native shell only accepts HTTPS servers or explicit private IPv4 HTTP origins. */
public final class ServerAddress {
    private ServerAddress() {}

    public static String normalize(String raw) throws IllegalArgumentException {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Введи адрес сервера ведущего.");
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if ((!scheme.equals("https") && !scheme.equals("http")) || host == null || host.isEmpty()) {
                throw new IllegalArgumentException("Нужен адрес вида http://192.168.1.5:8080 или https://server.example.");
            }
            if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                    || (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/"))) {
                throw new IllegalArgumentException("Укажи только адрес сервера, без логина, пути и параметров.");
            }
            int port = uri.getPort();
            if (port == 0 || port > 65535 || port < -1) throw new IllegalArgumentException("Неверный порт сервера.");
            host = host.toLowerCase(Locale.ROOT);
            if (scheme.equals("http") && !host.equals("localhost") && !isPrivateIpv4(host)) {
                throw new IllegalArgumentException("HTTP разрешён только для локального IP. Для сервера в интернете нужен HTTPS.");
            }
            if (port == (scheme.equals("https") ? 443 : 80)) port = -1;
            return new URI(scheme, null, host, port, null, null, null).toASCIIString();
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("Не удалось прочитать адрес сервера.");
        }
    }

    public static String origin(String url) {
        try {
            URI uri = new URI(url);
            if (uri.getHost() == null || uri.getScheme() == null || uri.getUserInfo() != null) return "";
            String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return "";
            int port = uri.getPort();
            if (port == (scheme.equals("https") ? 443 : 80)) port = -1;
            return new URI(scheme, null, uri.getHost().toLowerCase(Locale.ROOT), port, null, null, null).toASCIIString();
        } catch (Exception e) {
            return "";
        }
    }

    public static boolean sameOrigin(String candidate, String accepted) {
        String origin = origin(candidate);
        return !origin.isEmpty() && origin.equals(origin(accepted));
    }

    public static boolean isPrivateIpv4(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] address = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("[0-9]{1,3}") || (parts[i].length() > 1 && parts[i].startsWith("0"))) return false;
            try { address[i] = Integer.parseInt(parts[i]); } catch (NumberFormatException e) { return false; }
            if (address[i] > 255) return false;
        }
        return address[0] == 10 || address[0] == 127
                || (address[0] == 172 && address[1] >= 16 && address[1] <= 31)
                || (address[0] == 192 && address[1] == 168)
                || (address[0] == 169 && address[1] == 254);
    }
}
