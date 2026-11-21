#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_DIR="${ANDROID_SDK_ROOT:-/tmp/android-sdk}"
BUILD_TOOLS="${SDK_DIR}/build-tools/34.0.0"
ANDROID_JAR="${SDK_DIR}/platforms/android-34/android.jar"
WORK_DIR="/tmp/catan-apk-build"
OUT_APK="${1:-${ROOT_DIR}/catan.apk}"
KEYSTORE="${CATAN_KEYSTORE:-${HOME}/.gemini/catan-release.jks}"

if [[ ! -f "${ANDROID_JAR}" || ! -x "${BUILD_TOOLS}/aapt2" ]]; then
  echo "Android SDK 34 not found at ${SDK_DIR}." >&2
  exit 1
fi

echo "▸ Building web client..."
(cd "${ROOT_DIR}/client" && npm run build)

echo "▸ Preparing Android resources & assets..."
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}/res/mipmap-xxxhdpi" "${WORK_DIR}/res/mipmap-xxhdpi" "${WORK_DIR}/res/values"
mkdir -p "${WORK_DIR}/assets/www" "${WORK_DIR}/gen" "${WORK_DIR}/obj" "${WORK_DIR}/dex"

cp "${ROOT_DIR}/android/res/values/styles.xml" "${WORK_DIR}/res/values/styles.xml"
cp "${ROOT_DIR}/client/public/icon-512.png" "${WORK_DIR}/res/mipmap-xxxhdpi/ic_launcher.png"
cp "${ROOT_DIR}/client/public/icon-192.png" "${WORK_DIR}/res/mipmap-xxhdpi/ic_launcher.png"
cp -r "${ROOT_DIR}/client/dist/." "${WORK_DIR}/assets/www/"

echo "▸ Compiling resources (aapt2)..."
"${BUILD_TOOLS}/aapt2" compile --dir "${WORK_DIR}/res" -o "${WORK_DIR}/res.zip"
"${BUILD_TOOLS}/aapt2" link \
  -I "${ANDROID_JAR}" \
  --manifest "${ROOT_DIR}/android/AndroidManifest.xml" \
  -A "${WORK_DIR}/assets" \
  --java "${WORK_DIR}/gen" \
  -o "${WORK_DIR}/unaligned.apk" \
  "${WORK_DIR}/res.zip"

echo "▸ Compiling Java sources..."
javac -source 11 -target 11 \
  -classpath "${ANDROID_JAR}" \
  -d "${WORK_DIR}/obj" \
  "${ROOT_DIR}/android/src/com/krioku/catan/MainActivity.java" \
  "${WORK_DIR}/gen/com/krioku/catan/R.java"

echo "▸ Converting bytecode to DEX (d8)..."
"${BUILD_TOOLS}/d8" \
  --min-api 24 \
  --lib "${ANDROID_JAR}" \
  --output "${WORK_DIR}/dex" \
  $(find "${WORK_DIR}/obj" -name '*.class')

echo "▸ Packaging DEX into APK..."
(cd "${WORK_DIR}/dex" && zip -q -u "${WORK_DIR}/unaligned.apk" classes.dex)

echo "▸ Aligning APK (zipalign)..."
"${BUILD_TOOLS}/zipalign" -f -p 4 "${WORK_DIR}/unaligned.apk" "${WORK_DIR}/aligned.apk"

echo "▸ Signing APK (apksigner)..."
if [[ ! -f "${KEYSTORE}" ]]; then
  mkdir -p "$(dirname "${KEYSTORE}")"
  keytool -genkeypair -v \
    -keystore "${KEYSTORE}" \
    -alias catan \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android \
    -dname "CN=Catan, OU=Games, O=Krioku, L=Unknown, S=Unknown, C=US" \
    >/dev/null 2>&1
fi

"${BUILD_TOOLS}/apksigner" sign \
  --ks "${KEYSTORE}" \
  --ks-key-alias catan \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "${OUT_APK}" \
  "${WORK_DIR}/aligned.apk"

rm -f "${OUT_APK}.idsig"

echo "▸ Verifying APK signature..."
"${BUILD_TOOLS}/apksigner" verify --verbose "${OUT_APK}"

ls -lh "${OUT_APK}"
echo "✓ Built signed APK: ${OUT_APK}"
