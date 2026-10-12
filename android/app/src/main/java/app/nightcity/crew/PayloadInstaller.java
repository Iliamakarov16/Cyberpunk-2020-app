package app.nightcity.crew;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Installs only versioned application files; never accesses the separate host-data directory. */
public final class PayloadInstaller {
    private static final String[] REQUIRED_FILES = {
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
            "static/index.html",
            "static/app.js",
            "static/appearance-init.js",
            "static/style.css",
            "static/dossier-theme.css",
            "static/deck-connection.css",
            "static/cyberoptic-preview.css",
            "static/access-settings.css",
            "static/campaign-dossier.css",
            "static/portrait-editor.css",
            "static/campaign-controls.css",
            "static/record-controls.css",
            "static/fonts/Dossier-Bold.woff",
            "static/fonts/Dossier-BoldItalic.woff",
            "static/style-textures/photocopy-grain-v1.png",
            "static/style-textures/dry-ink-v1.png"
    };

    private PayloadInstaller() { }

    /** Owns and closes archive, including when a complete installation is reused. */
    public static File install(InputStream archive, File filesDir, String payloadVersion) throws IOException {
        try (InputStream raw = archive) {
            File target = new File(filesDir, "payload-v" + payloadVersion);
            File marker = new File(target, ".complete");
            if (marker.isFile() && hasApplication(target)) return target;
            File temp = new File(filesDir, "payload-v" + payloadVersion + ".tmp");
            deleteTree(temp);
            if (!temp.mkdirs() && !temp.isDirectory()) throw new IOException("Cannot create payload directory");
            String safeRoot = temp.getCanonicalPath() + File.separator;
            long total = 0;
            int entries = 0;
            try {
                try (ZipInputStream zip = new ZipInputStream(raw)) {
                    ZipEntry entry;
                    byte[] buffer = new byte[32768];
                    while ((entry = zip.getNextEntry()) != null) {
                        if (++entries > 10000) throw new IOException("Payload has too many files");
                        File file = new File(temp, entry.getName());
                        if (!file.getCanonicalPath().startsWith(safeRoot) || entry.getName().contains("\\")) {
                            throw new IOException("Unsafe payload entry");
                        }
                        if (entry.isDirectory()) {
                            if (!file.mkdirs() && !file.isDirectory()) throw new IOException("Cannot create payload folder");
                        } else {
                            File parent = file.getParentFile();
                            if (!parent.mkdirs() && !parent.isDirectory()) throw new IOException("Cannot create payload folder");
                            try (FileOutputStream output = new FileOutputStream(file)) {
                                int count;
                                while ((count = zip.read(buffer)) != -1) {
                                    total += count;
                                    if (total > 128L * 1024 * 1024) throw new IOException("Payload is too large");
                                    output.write(buffer, 0, count);
                                }
                            }
                        }
                        zip.closeEntry();
                    }
                }
                if (!hasApplication(temp)) {
                    throw new IOException("В пакете обновления отсутствуют файлы приложения. "
                            + "Установи исправленную версию поверх текущей; данные игры сохранятся.");
                }
                try (FileOutputStream complete = new FileOutputStream(new File(temp, ".complete"))) {
                    complete.write(payloadVersion.getBytes(StandardCharsets.UTF_8));
                }
            } catch (IOException error) {
                deleteTree(temp);
                throw error;
            }
            deleteTree(target);
            if (!temp.renameTo(target)) throw new IOException("Cannot install payload");
            return target;
        }
    }

    private static boolean hasApplication(File root) {
        for (String name : REQUIRED_FILES) {
            File file = new File(root, name);
            if (!file.isFile() || file.length() <= 0) return false;
        }
        return true;
    }

    private static void deleteTree(File file) throws IOException {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (!file.delete()) throw new IOException("Cannot remove incomplete payload");
    }
}
