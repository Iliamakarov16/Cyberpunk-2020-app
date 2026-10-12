// Run with Groovy 3: groovy tests/VerifyApkIdentity.groovy (from project root).
// Execute the production closure against real AAPT-style output and stale IDs.
class GradleException extends RuntimeException {
    GradleException(String message) { super(message) }
}
def source = new File('android/app/build.gradle').getText('UTF-8')
def start = source.indexOf('def verifyApkIdentityBadging = {')
def end = source.indexOf('\ndef verifyFinalApkIdentity = {', start)
assert start >= 0 && end > start
def verifier = new GroovyShell(this.class.classLoader).evaluate(
    source.substring(start, end) + '\nreturn verifyApkIdentityBadging')
def good = "package: name='app.nightcity.crew' versionCode='160401' versionName='0.16.4-mobile.1' platformBuildVersionName='15'\nsdkVersion:'24'\n"
verifier(good, 'app.nightcity.crew', 160401, '0.16.4-mobile.1')
int denied = 0
[
    good.replace('160401', '160302'),
    good.replace('0.16.4-mobile.1', '0.16.3-mobile.2'),
    good.replace('app.nightcity.crew', 'app.other.crew'),
    'sdkVersion:\'24\'\n',
    good.replace("versionCode='160401'", "versionCode='not-a-number'")
].each { bad ->
    try {
        verifier(bad, 'app.nightcity.crew', 160401, '0.16.4-mobile.1')
        throw new AssertionError('Invalid manifest identity accepted')
    } catch (GradleException expected) { denied++ }
}
assert denied == 5
println 'APK identity gate: current manifest accepted; 5 stale/missing/invalid identities rejected.'
