// Metro config: lets the app import ../shared (zod schemas, safety rules, Skin Map geometry).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(sharedRoot, 'node_modules'),
];
config.resolver.extraNodeModules = { '@skinfix/shared': sharedRoot };

module.exports = config;
