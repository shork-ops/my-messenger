import { readFile, writeFile } from "node:fs/promises";

const path = "android/app/src/main/AndroidManifest.xml";
const manifest = await readFile(path, "utf8");
const filter = `            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.nexus.messenger" android:host="auth" android:path="/callback" />
            </intent-filter>
`;
if (!manifest.includes('android:scheme="com.nexus.messenger"')) {
  if (!manifest.includes("        </activity>")) throw new Error("Android activity not found");
  await writeFile(path, manifest.replace("        </activity>", filter + "        </activity>"));
}
