import app.nightcity.crew.PayloadInstaller;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/** Tests the production Java extractor and actual shipped ZIP, without Android or a mock extractor. */
public final class PayloadInstallerTest {
    private static int checks;
    private static final String VERSION = "test-update";
    private static final String[] CRITICAL_ASSETS = {
            "static/battle-ui.css",
            "static/atlas/index.html",
            "static/atlas/crew-campaign.js",
            "static/atlas/crew-bridge.js",
            "static/atlas/theme.js",
            "static/atlas/app.js",
            "static/atlas/dossier.css",
            "static/atlas/cyberdeck.js",
            "static/atlas/raster-refinement.js",
            "static/atlas/cyberdeck.css",
            "static/atlas/atlas-palette.css",
            "static/atlas/city-atlas-transition.css",
            "static/city-atlas-transition.css",
            "static/index.html", "static/app.js", "static/appearance-init.js", "static/style.css",
            "static/dossier-theme.css", "static/deck-connection.css", "static/cyberoptic-preview.css",
            "static/access-settings.css", "static/campaign-dossier.css",
            "static/portrait-editor.css", "static/campaign-controls.css",
            "static/record-controls.css",
            "static/fonts/Dossier-Bold.woff", "static/fonts/Dossier-BoldItalic.woff",
            "static/style-textures/photocopy-grain-v1.png", "static/style-textures/dry-ink-v1.png"
    };

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }

    private static byte[] bytes(String text) { return text.getBytes(StandardCharsets.UTF_8); }

    private static byte[] archive(Path path) throws IOException {
        if (path.toString().endsWith(".apk")) {
            try (ZipFile apk = new ZipFile(path.toFile())) {
                ZipEntry entry = apk.getEntry("assets/server.zip");
                if (entry == null) throw new IOException("APK has no assets/server.zip");
                try (InputStream input = apk.getInputStream(entry)) { return input.readAllBytes(); }
            }
        }
        return Files.readAllBytes(path);
    }

    private static byte[] zip(Map<String, String> files) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            for (Map.Entry<String, String> entry : files.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(bytes(entry.getValue()));
                zip.closeEntry();
            }
        }
        return output.toByteArray();
    }

    private static void reject(byte[] archive, File filesDir, String reason) throws IOException {
        try {
            PayloadInstaller.install(new ByteArrayInputStream(archive), filesDir, VERSION);
            throw new AssertionError("Invalid archive accepted: " + reason);
        } catch (IOException expected) {
            check(!new File(filesDir, "payload-v" + VERSION + ".tmp").exists(), "Failed extraction left a staging folder");
        }
    }

    private static void intact(Path database, Path oldPayload) throws IOException {
        check(Arrays.equals(Files.readAllBytes(database), bytes("existing campaigns, accounts and characters")), "Host data changed");
        check(Arrays.equals(Files.readAllBytes(oldPayload), bytes("previous working payload")), "Previous version changed");
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 2) throw new IllegalArgumentException("Usage: PayloadInstallerTest [VALID_APK_OR_ZIP] or BAD_APK_OR_ZIP VALID_APK_OR_ZIP");
        // The source bundle stays self-contained; release QA can additionally pass the actual broken APK.
        byte[] broken = args.length == 2 ? archive(Path.of(args[0])) : zip(Map.of(
                "index.html", "<title>Wrong archive root</title>", "app.js", "// script", "style.css", "body{}"));
        byte[] repaired = archive(Path.of(args.length == 2 ? args[1] : args.length == 1 ? args[0]
                : "android/app/src/main/assets/server.zip"));
        Path files = Files.createTempDirectory("nightcity-payload-test-");
        try {
            Path database = files.resolve("host-data/tracker.sqlite3");
            Files.createDirectories(database.getParent());
            Files.write(database, bytes("existing campaigns, accounts and characters"));
            Path previous = files.resolve("payload-vprevious/static/index.html");
            Files.createDirectories(previous.getParent());
            Files.write(previous, bytes("previous working payload"));

            // The delivered bad update has valid bytes but lacks the static/ path required by both runtimes.
            try {
                PayloadInstaller.install(new ByteArrayInputStream(broken), files.toFile(), VERSION);
                throw new AssertionError("The original broken update was accepted");
            } catch (IOException expected) {
                check(expected.getMessage().contains("Установи исправленную версию"), "Missing payload error is not actionable");
            }
            check(!files.resolve("payload-v" + VERSION).toFile().exists(), "Broken update was marked installed");
            check(!files.resolve("payload-v" + VERSION + ".tmp").toFile().exists(), "Broken archive left staging files");
            intact(database, previous);

            for (String path : new String[] {"../host-data/tracker.sqlite3", "static/../../host-data/tracker.sqlite3", "static\\index.html"}) {
                reject(zip(Map.of(path, "overwrite")), files.toFile(), path);
                intact(database, previous);
            }
            Map<String, String> incomplete = new LinkedHashMap<>();
            incomplete.put("static/index.html", "<title>Incomplete</title>");
            reject(zip(incomplete), files.toFile(), "missing script and stylesheet");
            incomplete.put("static/app.js", "// script");
            reject(zip(incomplete), files.toFile(), "missing stylesheet");
            // The old three-file gate passed even when the dossier, font, textures or boot init were absent.
            Map<String, String> completeFixture = new LinkedHashMap<>();
            for (String name : CRITICAL_ASSETS) completeFixture.put(name, "required asset " + name);
            for (String missing : CRITICAL_ASSETS) {
                Map<String, String> candidate = new LinkedHashMap<>(completeFixture);
                candidate.remove(missing);
                reject(zip(candidate), files.toFile(), "missing " + missing);
                check(!files.resolve("payload-v" + VERSION).toFile().exists(), "Missing " + missing + " was marked installed");
                intact(database, previous);

                candidate.put(missing, "");
                reject(zip(candidate), files.toFile(), "empty " + missing);
                check(!files.resolve("payload-v" + VERSION).toFile().exists(), "Empty " + missing + " was marked installed");
                intact(database, previous);
            }

            File installed = PayloadInstaller.install(new ByteArrayInputStream(repaired), files.toFile(), VERSION);
            check(installed.toPath().equals(files.resolve("payload-v" + VERSION)), "Wrong install path");
            check(Files.readString(installed.toPath().resolve(".complete")).equals(VERSION), "Wrong completion marker");
            try (ZipInputStream source = new ZipInputStream(new ByteArrayInputStream(repaired))) {
                ZipEntry entry;
                int assets = 0;
                while ((entry = source.getNextEntry()) != null) {
                    check(entry.getName().startsWith("static/"), "Actual shipped asset is outside static/: " + entry.getName());
                    if (!entry.isDirectory()) {
                        check(Arrays.equals(source.readAllBytes(), Files.readAllBytes(installed.toPath().resolve(entry.getName()))), "Installed asset changed: " + entry.getName());
                        assets++;
                    }
                }
                check(assets >= CRITICAL_ASSETS.length, "Actual repaired archive has too few assets");
            }
            for (String name : CRITICAL_ASSETS) {
                Path required = installed.toPath().resolve(name);
                check(Files.isRegularFile(required) && Files.size(required) > 0, "Actual archive lacks nonempty " + name);
            }
            intact(database, previous);

            class Unreadable extends InputStream {
                boolean closed;
                @Override public int read() throws IOException { throw new IOException("A cached install must not read the ZIP"); }
                @Override public void close() { closed = true; }
            }
            Unreadable unused = new Unreadable();
            check(PayloadInstaller.install(unused, files.toFile(), VERSION).equals(installed), "Complete payload was not reused");
            check(unused.closed, "Unused archive was not closed");

            // A completion marker must not hide a lost or empty theme, font, texture or application script.
            for (String damaged : new String[] {
                    "static/atlas/cyberdeck.js",
            "static/atlas/raster-refinement.js", "static/atlas/cyberdeck.css", "static/city-atlas-transition.css",
                    "static/app.js", "static/dossier-theme.css", "static/fonts/Dossier-Bold.woff",
                    "static/style-textures/photocopy-grain-v1.png", "static/appearance-init.js",
                    "static/portrait-editor.css", "static/campaign-controls.css", "static/record-controls.css"
            }) {
                Files.delete(installed.toPath().resolve(damaged));
                Files.writeString(installed.toPath().resolve("stale-file"), "remove on reinstallation");
                Path staging = files.resolve("payload-v" + VERSION + ".tmp");
                Files.createDirectories(staging);
                Files.writeString(staging.resolve("interrupted"), "incomplete update");
                PayloadInstaller.install(new ByteArrayInputStream(repaired), files.toFile(), VERSION);
                Path restored = installed.toPath().resolve(damaged);
                check(Files.isRegularFile(restored) && Files.size(restored) > 0, "Stale marker hid missing " + damaged);
                check(!Files.exists(installed.toPath().resolve("stale-file")), "Recovery retained stale files");
                check(!Files.exists(staging), "Successful recovery left a staging folder");
                intact(database, previous);
            }
            for (String damaged : new String[] {
                    "static/campaign-dossier.css", "static/portrait-editor.css", "static/campaign-controls.css",
                    "static/record-controls.css"
            }) {
                Path emptyTheme = installed.toPath().resolve(damaged);
                Files.write(emptyTheme, new byte[0]);
                PayloadInstaller.install(new ByteArrayInputStream(repaired), files.toFile(), VERSION);
                check(Files.size(emptyTheme) > 0, "Stale marker hid empty " + damaged);
                intact(database, previous);
            }
            System.out.println("PayloadInstaller: " + checks + " production extraction, archive and data preservation checks passed.");
        } finally {
            try (var paths = Files.walk(files)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }
}
