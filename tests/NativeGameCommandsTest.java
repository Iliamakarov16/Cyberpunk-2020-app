package app.nightcity.crew;

public final class NativeGameCommandsTest {
    private static int assertions;

    private static void expect(NativeGameCommands.Command expected, String message,
                               String source, String document, String accepted, boolean mainFrame) {
        NativeGameCommands.Command result = NativeGameCommands.parse(message, source, document, accepted, mainFrame);
        assertions++;
        if (result != expected) throw new AssertionError("Rejected command/origin policy: " + message + " from " + source);
    }

    public static void main(String[] args) {
        String local = "http://127.0.0.1:8080";
        String remote = "https://game.example";
        expect(NativeGameCommands.Command.CONNECTION, "connection", local, local + "/campaign?id=1", local, true);
        expect(NativeGameCommands.Command.RELOAD, "reload", remote, remote + "/settings", remote, true);
        expect(NativeGameCommands.Command.CONNECTION, "connection", "https://GAME.example:443", remote, remote, true);
        expect(NativeGameCommands.Command.BOOT_ENABLED, "boot-enabled", local, local + "/settings", local, true);
        expect(NativeGameCommands.Command.BOOT_DISABLED, "boot-disabled", local, local + "/settings", local, true);
        expect(NativeGameCommands.Command.BOOT_ENABLED, "boot-enabled", remote, remote + "/settings", remote, true);
        expect(NativeGameCommands.Command.BOOT_DISABLED, "boot-disabled", remote, remote + "/settings", remote, true);
        for (String message : new String[]{"boot-enabled", "boot-disabled"}) {
            expect(NativeGameCommands.Command.NONE, message, remote, remote, remote, false);
            expect(NativeGameCommands.Command.NONE, message, "https://other.example", remote, remote, true);
            expect(NativeGameCommands.Command.NONE, message, remote, "https://other.example/settings", remote, true);
            expect(NativeGameCommands.Command.NONE, message, "http://127.0.0.1:8081", local, local, true);
        }
        for (String message : new String[]{"battle-enter", "battle-exit"}) {
            NativeGameCommands.Command expected = message.equals("battle-enter") ? NativeGameCommands.Command.BATTLE_ENTER : NativeGameCommands.Command.BATTLE_EXIT;
            expect(expected, message, local, local + "/", local, true);
            expect(expected, message, remote, remote + "/", remote, true);
            expect(NativeGameCommands.Command.NONE, message, remote, remote, remote, false);
            expect(NativeGameCommands.Command.NONE, message, local, remote, remote, true);
            expect(NativeGameCommands.Command.NONE, message, remote, local, remote, true);
        }
        NativeGameCommands.Command[] palettes = {NativeGameCommands.Command.PALETTE_CARMINE,
                NativeGameCommands.Command.PALETTE_ULTRAVIOLET, NativeGameCommands.Command.PALETTE_AMBER,
                NativeGameCommands.Command.PALETTE_MAELSTROM, NativeGameCommands.Command.PALETTE_ORIGINAL};
        for (NativeGameCommands.Command palette : palettes) {
            String message = "palette-" + NativeGameCommands.paletteName(palette);
            expect(palette, message, local, local + "/settings", local, true);
            expect(palette, message, remote, remote + "/settings", remote, true);
            expect(NativeGameCommands.Command.NONE, message, remote, remote, remote, false);
            expect(NativeGameCommands.Command.NONE, message, "https://other.example", remote, remote, true);
            expect(NativeGameCommands.Command.NONE, message, remote, "https://other.example/settings", remote, true);
        }
        expect(NativeGameCommands.Command.RECOVER_ACCOUNT, "recover-account", local, local + "/?login=1", local, true);
        expect(NativeGameCommands.Command.NONE, "recover-account", local, local, local, false);
        expect(NativeGameCommands.Command.NONE, "recover-account", remote, remote + "/login", remote, true);
        expect(NativeGameCommands.Command.NONE, "recover-account", local, remote, local, true);
        expect(NativeGameCommands.Command.NONE, "recover-account", remote, local, local, true);
        expect(NativeGameCommands.Command.NONE, "recover-account", local, local, remote, true);
        expect(NativeGameCommands.Command.NONE, "recover-account", "http://localhost:8080", "http://localhost:8080", "http://localhost:8080", true);
        expect(NativeGameCommands.Command.NONE, "recover-account", "http://127.0.0.1:8081", "http://127.0.0.1:8081", "http://127.0.0.1:8081", true);
        expect(NativeGameCommands.Command.NONE, "recover-account", "http://192.168.43.1:8080", "http://192.168.43.1:8080", "http://192.168.43.1:8080", true);
        expect(NativeGameCommands.Command.NONE, "recover-account", "https://127.0.0.1:8080", "https://127.0.0.1:8080", "https://127.0.0.1:8080", true);
        expect(NativeGameCommands.Command.NONE, "recover-account", local + "/", local, local, true);
        expect(NativeGameCommands.Command.NONE, "recover-account", local, local, local + "/", true);
        expect(NativeGameCommands.Command.NONE, "recover-account", local, "http://user@127.0.0.1:8080/", local, true);
        expect(NativeGameCommands.Command.NONE, "recover-account", local, local, null, true);
        expect(NativeGameCommands.Command.NONE, "connection", local, local, local, false);
        expect(NativeGameCommands.Command.NONE, "connection", remote, local, local, true);
        expect(NativeGameCommands.Command.NONE, "connection", local, remote, local, true);
        expect(NativeGameCommands.Command.NONE, "connection", "http://127.0.0.1:8081", local, local, true);
        expect(NativeGameCommands.Command.NONE, "reload", "http://game.example", remote, remote, true);
        expect(NativeGameCommands.Command.NONE, "reload", remote, "https://game.example.evil/", remote, true);
        expect(NativeGameCommands.Command.NONE, "connection", "https://game.example.evil", remote, remote, true);
        expect(NativeGameCommands.Command.NONE, "connection", "https://user:secret@game.example", remote, remote, true);
        expect(NativeGameCommands.Command.NONE, "connection", null, remote, remote, true);
        expect(NativeGameCommands.Command.NONE, "connection", remote, null, remote, true);
        expect(NativeGameCommands.Command.NONE, "connection", "", "", "", true);
        expect(NativeGameCommands.Command.NONE, "connection", "file:///game", "file:///game", "file:///game", true);
        expect(NativeGameCommands.Command.NONE, "connection", "content://game", "content://game", "content://game", true);
        for (String message : new String[]{null, "", " connection", "connection ", "Connection", "reload;", "stop-server", "delete", " recover-account", "recover-account ", "Recover-account", "recover-account:password", "palette-black", "palette-Carmine", " palette-carmine", "palette-carmine ", "palette-carmine;delete", "open:https://evil.example", "{\"command\":\"connection\"}", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}) {
            expect(NativeGameCommands.Command.NONE, message, local, local, local, true);
        }
        System.out.println("Native game command policy: " + assertions + " assertions passed.");
    }
}
