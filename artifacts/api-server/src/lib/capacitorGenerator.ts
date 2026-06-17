/**
 * capacitorGenerator.ts
 * 
 * Generador de configuración de Capacitor para aplicaciones móviles.
 * Crea automáticamente los archivos necesarios para compilar a Android e iOS.
 */

import path from "node:path";

/**
 * Genera el contenido de capacitor.config.ts
 */
export function generateCapacitorConfig(opts: {
  appId: string;
  appName: string;
  webDir?: string;
}): string {
  const webDir = opts.webDir || "dist";
  return `import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${opts.appId}',
  appName: '${opts.appName}',
  webDir: '${webDir}',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
`;
}

/**
 * Genera el contenido de package.json con dependencias de Capacitor
 */
export function generateCapacitorPackageJson(opts: {
  appName: string;
  appId: string;
  version?: string;
}): Record<string, any> {
  return {
    name: opts.appName.toLowerCase().replace(/\s+/g, "-"),
    version: opts.version || "1.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
      "build:mobile": "vite build && cap sync",
      "build:android": "vite build && cap sync android && cd android && ./gradlew assembleDebug",
      "build:ios": "vite build && cap sync ios",
    },
    dependencies: {
      react: "^18.2.0",
      "react-dom": "^18.2.0",
      "@capacitor/core": "^6.0.0",
      "@capacitor/android": "^6.0.0",
      "@capacitor/ios": "^6.0.0",
      "@capacitor/splash-screen": "^6.0.0",
      "@capacitor/status-bar": "^6.0.0",
    },
    devDependencies: {
      "@capacitor/cli": "^6.0.0",
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
      "@vitejs/plugin-react": "^4.0.0",
      typescript: "^5.0.0",
      vite: "^5.0.0",
    },
  };
}

/**
 * Genera el contenido de AndroidManifest.xml
 */
export function generateAndroidManifest(opts: {
  packageName: string;
  appName: string;
}): string {
  return `<?xml version='1.0' encoding='utf-8'?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${opts.packageName}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="true">

        <activity
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme"
            android:launchMode="singleTask"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

    </application>

</manifest>
`;
}

/**
 * Genera el contenido de build.gradle para Android
 */
export function generateAndroidBuildGradle(opts: {
  packageName: string;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  compileSdkVersion?: number;
}): string {
  const minSdk = opts.minSdkVersion || 21;
  const targetSdk = opts.targetSdkVersion || 33;
  const compileSdk = opts.compileSdkVersion || 33;

  return `apply plugin: 'com.android.application'
apply plugin: 'kotlin-android'
apply from: variables.gradle

android {
    compileSdkVersion ${compileSdk}

    defaultConfig {
        applicationId "${opts.packageName}"
        minSdkVersion ${minSdk}
        targetSdkVersion ${targetSdk}
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = '1.8'
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'androidx.constraintlayout:constraintlayout:2.1.4'
    implementation 'androidx.legacy:legacy-support-v4:1.0.0'
    implementation 'androidx.browser:browser:1.5.0'
    implementation 'com.google.android.material:material:1.9.0'
    testImplementation 'junit:junit:4.13.2'
    androidTestImplementation 'androidx.test.ext:junit:1.1.5'
    androidTestImplementation 'androidx.test.espresso:espresso-core:3.5.1'
    implementation project(':capacitor-android')
    for (capacitorPlugin in capacitorPlugins) {
        implementation capacitorPlugin
    }
}

apply from: 'capacitor.gradle'

if (hasProperty('postBuildExtras')) {
    postBuildExtras()
}
`;
}

/**
 * Genera el contenido de Info.plist para iOS
 */
export function generateIOSInfoPlist(opts: {
  bundleId: string;
  appName: string;
  version?: string;
}): string {
  const version = opts.version || "1.0";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>\$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>${opts.bundleId}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${opts.appName}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${version}</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>UILaunchStoryboardName</key>
    <string>LaunchScreen</string>
    <key>UIMainStoryboardFile</key>
    <string>Main</string>
    <key>UIRequiredDeviceCapabilities</key>
    <array>
        <string>armv7</string>
    </array>
    <key>UISupportedInterfaceOrientations</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UISupportedInterfaceOrientations~ipad</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationPortraitUpsideDown</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UIViewControllerBasedStatusBarAppearance</key>
    <true/>
    <key>NSLocalNetworkUsageDescription</key>
    <string>This app needs access to your local network to function properly.</string>
    <key>NSBonjourServices</key>
    <array>
        <string>_http._tcp</string>
        <string>_https._tcp</string>
    </array>
</dict>
</plist>
`;
}

/**
 * Genera el contenido de Podfile para iOS
 */
export function generateIOSPodfile(opts: {
  appName: string;
  deploymentTarget?: string;
}): string {
  const deploymentTarget = opts.deploymentTarget || "13.0";
  return `platform :ios, '${deploymentTarget}'

target 'App' do
  capacitor_pods
  pod 'Capacitor', :path => '../../node_modules/@capacitor/ios'
  pod 'CapacitorCordova', :path => '../../node_modules/@capacitor/ios'
  pod 'CapacitorSplashScreen', :path => '../../node_modules/@capacitor/splash-screen'
  pod 'CapacitorStatusBar', :path => '../../node_modules/@capacitor/status-bar'
end

post_install do |installer|
  assertDeploymentTarget(installer)
end
`;
}

/**
 * Genera el contenido de MainActivity.java para Android
 */
export function generateAndroidMainActivity(opts: {
  packageName: string;
}): string {
  return `package ${opts.packageName};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
`;
}

/**
 * Estructura completa de archivos para un proyecto móvil
 */
export interface MobileProjectStructure {
  "capacitor.config.ts": string;
  "android/app/src/main/AndroidManifest.xml": string;
  "android/app/build.gradle": string;
  "android/build.gradle": string;
  "android/gradle.properties": string;
  "android/settings.gradle": string;
  "ios/App/App/Info.plist": string;
  "ios/App/Podfile": string;
}

/**
 * Genera la estructura completa de archivos para un proyecto móvil
 */
export function generateMobileProjectStructure(opts: {
  appId: string;
  appName: string;
  packageName: string;
  bundleId: string;
  webDir?: string;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  iosDeploymentTarget?: string;
}): MobileProjectStructure {
  return {
    "capacitor.config.ts": generateCapacitorConfig({
      appId: opts.appId,
      appName: opts.appName,
      webDir: opts.webDir,
    }),
    "android/app/src/main/AndroidManifest.xml": generateAndroidManifest({
      packageName: opts.packageName,
      appName: opts.appName,
    }),
    "android/app/build.gradle": generateAndroidBuildGradle({
      packageName: opts.packageName,
      minSdkVersion: opts.minSdkVersion,
      targetSdkVersion: opts.targetSdkVersion,
    }),
    "android/build.gradle": `buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.0.0'
        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.8.0'
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
`,
    "android/gradle.properties": `org.gradle.jvmargs=-Xmx1024m
android.useAndroidX=true
android.enableJetifier=true
`,
    "android/settings.gradle": `include ':app'
include ':capacitor-android'
project(':capacitor-android').projectDir = new File('../../node_modules/@capacitor/android/capacitor')
`,
    "ios/App/App/Info.plist": generateIOSInfoPlist({
      bundleId: opts.bundleId,
      appName: opts.appName,
    }),
    "ios/App/Podfile": generateIOSPodfile({
      appName: opts.appName,
      deploymentTarget: opts.iosDeploymentTarget,
    }),
  };
}
