package app.nightcity.crew;

public final class NativePasswordPolicyTest {
    public static void main(String[] args) {
        String[] valid = {"abcdefghijkl", "a".repeat(256), "😀".repeat(12), "😀".repeat(256), " пароль с пробелами "};
        String[] invalid = {null, "", "a".repeat(11), "a".repeat(257), "😀".repeat(11), "😀".repeat(257),
                "abcdefghijk\ud800", "abcdefghijk\udc00", "abcdefghijk\ud800x"};
        for (String secret : valid) if (!NativePasswordPolicy.valid(secret)) throw new AssertionError("Valid length rejected");
        for (String secret : invalid) if (NativePasswordPolicy.valid(secret)) throw new AssertionError("Invalid length or Unicode accepted");
        System.out.println("Native owner password policy: " + (valid.length + invalid.length) + " checks passed.");
    }
}
