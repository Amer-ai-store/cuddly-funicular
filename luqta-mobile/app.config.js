// Release builds pass VERSION_CODE / VERSION_NAME (the CI run number), so every published APK installs over the last.
module.exports = ({ config }) => ({
  ...config,
  version: process.env.VERSION_NAME || config.version,
  android: { ...config.android, versionCode: Number(process.env.VERSION_CODE) || config.android.versionCode },
});
