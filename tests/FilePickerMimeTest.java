package app.nightcity.crew;
import java.util.Arrays;
public final class FilePickerMimeTest {
    static void eq(String[] actual,String... expected){if(!Arrays.equals(actual,expected))throw new AssertionError(Arrays.toString(actual));}
    public static void main(String[] args){
        eq(FilePickerMime.normalize(null));eq(FilePickerMime.normalize(new String[]{""}));
        eq(FilePickerMime.normalize(new String[]{"application/json", ".json", ".campaign.json"}),"application/json","text/plain","application/octet-stream");
        eq(FilePickerMime.normalize(new String[]{".JSON, application/json"}),"application/json","text/plain","application/octet-stream");
        eq(FilePickerMime.normalize(new String[]{"image/*"}),"image/*");
        eq(FilePickerMime.normalize(new String[]{".jpg", ".png", ".webp"}),"image/jpeg","image/png","image/webp");
        eq(FilePickerMime.normalize(new String[]{".json", "*/*"}));
        eq(FilePickerMime.normalize(new String[]{null,"not a mime", ".unknown"}));
        System.out.println("FilePickerMime: extension normalization, JSON provider compatibility and image filters passed");
    }
}
