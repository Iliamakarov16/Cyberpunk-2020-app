package app.nightcity.crew;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/** Prevent native launch pages from drifting from the actual packaged CSS. */
public final class NativePaletteTest {
    public static void main(String[] args) throws Exception {
        String css = Files.readString(Paths.get(args[0]));
        int assertions = 0;
        for (String name : new String[]{"carmine", "ultraviolet", "amber", "maelstrom", "original"}) {
            NativePalette colors = NativePalette.from(name);
            if (!name.equals(colors.name)) throw new AssertionError("Palette name changed");
            Matcher block = Pattern.compile(":root\\[data-palette=\"" + name + "\"\\]\\s*\\{([^}]+)\\}").matcher(css);
            if (!block.find()) throw new AssertionError("Missing web palette: " + name);
            String[] tokens = {"ink", "surface", "raised", "deep", "text", "muted", "red", "signal", "register", "identity-bg", "identity-text", "identity-muted"};
            int[] values = {colors.background, colors.surface, colors.raised, colors.deep, colors.text, colors.muted,
                    colors.accent, colors.signal, colors.line, colors.identityBackground, colors.identityText, colors.identityMuted};
            for (int i = 0; i < tokens.length; i++) {
                Matcher token = Pattern.compile("--nc-" + tokens[i] + ":#([0-9a-fA-F]{6})(?:;|\\s)").matcher(block.group(1));
                if (!token.find() || Integer.parseInt(token.group(1), 16) != (values[i] & 0xffffff))
                    throw new AssertionError("Native/web mismatch: " + name + "/" + tokens[i]);
                assertions++;
            }
        }
        if (!"carmine".equals(NativePalette.from(null).name) || !"carmine".equals(NativePalette.from("unknown").name))
            throw new AssertionError("Unknown palette must use the shared default");
        System.out.println("Native/web palette parity: " + (assertions + 2) + " assertions passed.");
    }
}
