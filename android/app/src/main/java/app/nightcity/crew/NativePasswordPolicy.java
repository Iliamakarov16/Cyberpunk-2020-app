package app.nightcity.crew;

/** Match the backend's Unicode length and UTF-8 validity before owner setup. */
public final class NativePasswordPolicy {
    private NativePasswordPolicy() { }

    public static boolean valid(String password) {
        if (password == null) return false;
        int count = password.codePointCount(0, password.length());
        if (count < 12 || count > 256) return false;
        for (int i = 0; i < password.length(); i++) {
            char value = password.charAt(i);
            if (Character.isHighSurrogate(value)) {
                if (++i == password.length() || !Character.isLowSurrogate(password.charAt(i))) return false;
            } else if (Character.isLowSurrogate(value)) return false;
        }
        return true;
    }
}
