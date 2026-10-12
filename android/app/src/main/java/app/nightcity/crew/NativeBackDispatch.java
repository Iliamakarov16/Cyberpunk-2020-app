package app.nightcity.crew;

/** Back belongs to the SPA. A false/unavailable reply permits only an explicit exit dialog. */
public final class NativeBackDispatch {
    private NativeBackDispatch() {}
    public static String script() {
        return "(()=>{if(window.top!==window)return false;const event=new Event('nightcity-native-back',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()";
    }
    public static boolean handled(String reply) { return "true".equals(reply); }
}
