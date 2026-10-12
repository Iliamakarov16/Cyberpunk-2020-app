package app.nightcity.crew;
public final class NativeBackDispatchTest {
    public static void main(String[] args) {
        if (!NativeBackDispatch.handled("true")) throw new AssertionError("Handled reply");
        for (String value : new String[]{null,"false","null","undefined","\"true\"","1"," true"})
            if (NativeBackDispatch.handled(value)) throw new AssertionError("Strict reply");
        String script = NativeBackDispatch.script();
        if (!script.contains("nightcity-native-back") || !script.contains("cancelable:true") || !script.contains("defaultPrevented")) throw new AssertionError("Cancelable SPA dispatch");
        if (script.contains("history.back") || script.contains("connection") || script.contains("location")) throw new AssertionError("Back must not navigate to connection");
        System.out.println("Native Back dispatch: strict cancelable in-app contract passed.");
    }
}
