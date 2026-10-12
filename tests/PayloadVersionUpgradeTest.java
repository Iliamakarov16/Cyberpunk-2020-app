import app.nightcity.crew.PayloadInstaller;
import java.io.*;
import java.nio.file.*;
import java.util.*;
/** Real extractor/version-path exercise; caller supplies a disposable valid SQLite database. */
public final class PayloadVersionUpgradeTest {
 public static void main(String[] args) throws Exception {
  Path files=Path.of(args[0]),oldZip=Path.of(args[1]),newZip=Path.of(args[2]);String version=args[3];
  Path data=files.resolve("host-data/tracker.sqlite3"),prefs=files.resolve("preferences.fixture");
  byte[] before=Files.readAllBytes(data),preference=Files.readAllBytes(prefs);
  // The previous real release remains intact; only the new version gets the new archive.
  Path old=files.resolve("payload-v0.17.6-mobile.1");Files.createDirectories(old);
  try(java.util.zip.ZipInputStream zip=new java.util.zip.ZipInputStream(Files.newInputStream(oldZip))){java.util.zip.ZipEntry e;while((e=zip.getNextEntry())!=null){Path dest=old.resolve(e.getName());if(!dest.normalize().startsWith(old))throw new AssertionError("Unsafe fixture");if(!e.isDirectory()){Files.createDirectories(dest.getParent());Files.copy(zip,dest,StandardCopyOption.REPLACE_EXISTING);}}}
  Files.writeString(old.resolve(".complete"),"0.17.6-mobile.1");byte[] oldApp=Files.readAllBytes(old.resolve("static/app.js"));
  File next=PayloadInstaller.install(Files.newInputStream(newZip),files.toFile(),version);
  if(next.toPath().equals(old)||!next.toPath().equals(files.resolve("payload-v"+version)))throw new AssertionError("Old payload reused");
  if(!Files.readString(next.toPath().resolve(".complete")).equals(version))throw new AssertionError("New marker missing");
  if(Arrays.equals(oldApp,Files.readAllBytes(next.toPath().resolve("static/app.js"))))throw new AssertionError("New frontend was not installed");
  if(!Files.isRegularFile(next.toPath().resolve("static/atlas/raster-refinement.js")))throw new AssertionError("New Atlas missing");
  if(!Arrays.equals(before,Files.readAllBytes(data))||!Arrays.equals(preference,Files.readAllBytes(prefs))||!Arrays.equals(oldApp,Files.readAllBytes(old.resolve("static/app.js"))))throw new AssertionError("Existing data changed");
  if(!PayloadInstaller.install(new ByteArrayInputStream(new byte[0]),files.toFile(),version).equals(next))throw new AssertionError("Verified new cache not reused");
  System.out.println("Actual old-to-new payload install/reuse preserved SQLite bytes, preferences and old assets.");
 }
}
