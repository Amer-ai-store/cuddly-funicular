const { withAndroidManifest } = require('@expo/config-plugins');

// Preview builds can reach a self-hosted server by its private LAN address.
// The client validates public endpoints as HTTPS before storing credentials.
module.exports = function withLocalNetwork(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
};
