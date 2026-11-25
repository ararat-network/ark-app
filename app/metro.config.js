// The bundler's config. The app takes the signer by path, as a sibling
// package and not a workspace member, so the bundler is told to watch that
// directory: it follows the link in node_modules and transforms the signer's
// TypeScript as it does the app's own.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../signer")];

module.exports = config;
