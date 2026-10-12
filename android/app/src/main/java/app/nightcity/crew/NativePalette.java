package app.nightcity.crew;

/** The native connection pages share the web dossier's five palette tokens. */
public final class NativePalette {
    public final String name;
    public final int background, surface, raised, deep, text, muted, accent, signal, line;
    public final int identityBackground, identityText, identityMuted;

    private NativePalette(String name, int background, int surface, int raised, int deep,
                          int text, int muted, int accent, int signal, int line,
                          int identityBackground, int identityText, int identityMuted) {
        this.name = name;
        this.background = opaque(background); this.surface = opaque(surface);
        this.raised = opaque(raised); this.deep = opaque(deep);
        this.text = opaque(text); this.muted = opaque(muted); this.accent = opaque(accent);
        this.signal = opaque(signal); this.line = opaque(line);
        this.identityBackground = opaque(identityBackground);
        this.identityText = opaque(identityText); this.identityMuted = opaque(identityMuted);
    }

    private static int opaque(int rgb) { return 0xff000000 | rgb; }

    public static NativePalette from(String name) {
        if ("original".equals(name)) return new NativePalette("original", 0x03080c, 0x081017, 0x17242a, 0x02070b,
                0xd7e8e1, 0x9cafac, 0xf2154e, 0xc6ddd2, 0x61706f, 0x142127, 0xd7e8e1, 0xb6ccc3);
        if ("ultraviolet".equals(name)) return new NativePalette("ultraviolet", 0x07060a, 0x121016, 0x1d1725, 0x040307,
                0xf2ebf7, 0xb6adbe, 0xc86bf0, 0xd8ff45, 0x716278, 0x09080c, 0xd8ff45, 0xf2ebf7);
        if ("amber".equals(name)) return new NativePalette("amber", 0x080a08, 0x111510, 0x1e2119, 0x040604,
                0xeeead5, 0xb4b7a4, 0xffc663, 0xb9d2b3, 0x6c7060, 0xeeead5, 0x111510, 0x343d30);
        if ("maelstrom".equals(name)) return new NativePalette("maelstrom", 0x080909, 0x141515, 0x222323, 0x030404,
                0xeeefe9, 0xb0b2ad, 0xff3948, 0xe4e6df, 0x72756f, 0xb5b8b0, 0x101210, 0x292e28);
        return new NativePalette("carmine", 0x080406, 0x130a0e, 0x211117, 0x050305,
                0xf3e4cc, 0xb9a79d, 0xff285c, 0xedc88c, 0x795d66, 0xff285c, 0x18070d, 0x18070d);
    }
}
