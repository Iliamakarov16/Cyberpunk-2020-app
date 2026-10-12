package app.nightcity.crew;

/** Small, origin-checked command vocabulary exposed to the game's main frame. */
public final class NativeGameCommands {
    public enum Command { NONE, CONNECTION, RELOAD, BATTLE_ENTER, BATTLE_EXIT, RECOVER_ACCOUNT, BOOT_ENABLED, BOOT_DISABLED,
        PALETTE_CARMINE, PALETTE_ULTRAVIOLET, PALETTE_AMBER, PALETTE_MAELSTROM, PALETTE_ORIGINAL }

    private NativeGameCommands() {}

    public static Command parse(String message, String sourceOrigin, String documentUrl,
                                String acceptedOrigin, boolean mainFrame) {
        if (!mainFrame || message == null || message.length() > 32
                || !ServerAddress.sameOrigin(sourceOrigin, acceptedOrigin)
                || !ServerAddress.sameOrigin(documentUrl, acceptedOrigin)) return Command.NONE;
        if ("connection".equals(message)) return Command.CONNECTION;
        if ("reload".equals(message)) return Command.RELOAD;
        if ("battle-enter".equals(message)) return Command.BATTLE_ENTER;
        if ("battle-exit".equals(message)) return Command.BATTLE_EXIT;
        if ("boot-enabled".equals(message)) return Command.BOOT_ENABLED;
        if ("boot-disabled".equals(message)) return Command.BOOT_DISABLED;
        if ("palette-carmine".equals(message)) return Command.PALETTE_CARMINE;
        if ("palette-ultraviolet".equals(message)) return Command.PALETTE_ULTRAVIOLET;
        if ("palette-amber".equals(message)) return Command.PALETTE_AMBER;
        if ("palette-maelstrom".equals(message)) return Command.PALETTE_MAELSTROM;
        if ("palette-original".equals(message)) return Command.PALETTE_ORIGINAL;
        if ("recover-account".equals(message)
                && "http://127.0.0.1:8080".equals(acceptedOrigin)
                && "http://127.0.0.1:8080".equals(sourceOrigin)
                && "http://127.0.0.1:8080".equals(ServerAddress.origin(documentUrl))) {
            return Command.RECOVER_ACCOUNT;
        }
        return Command.NONE;
    }

    public static String paletteName(Command command) {
        if (command == Command.PALETTE_CARMINE) return "carmine";
        if (command == Command.PALETTE_ULTRAVIOLET) return "ultraviolet";
        if (command == Command.PALETTE_AMBER) return "amber";
        if (command == Command.PALETTE_MAELSTROM) return "maelstrom";
        if (command == Command.PALETTE_ORIGINAL) return "original";
        return null;
    }
}
