package app.nightcity.crew;

import java.util.LinkedHashSet;
import java.util.Locale;

/** HTML accept extensions are not Android MIME types. The server still validates bytes. */
final class FilePickerMime {
    static String[] normalize(String[] values) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        if (values == null) return new String[0];
        for (String value : values) {
            if (value == null) continue;
            for (String token : value.toLowerCase(Locale.ROOT).split(",")) {
                String mime = token.trim();
                if (mime.equals("*/*")) return new String[0];
                if (mime.endsWith(".json") || mime.equals("application/json")) {
                    result.add("application/json");
                    // Android Downloads/Drive may label user JSON as generic text/binary.
                    result.add("text/plain"); result.add("application/octet-stream");
                } else if (mime.equals(".png")) result.add("image/png");
                else if (mime.equals(".jpg") || mime.equals(".jpeg")) result.add("image/jpeg");
                else if (mime.equals(".webp")) result.add("image/webp");
                else if (mime.matches("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+*-]+")) result.add(mime);
            }
        }
        return result.toArray(new String[0]);
    }
}
