// eslint-disable-next-line import/no-extraneous-dependencies
const defaultConfig = require('./jest.config.js');

module.exports = {
  displayName: "e2e",
  ...defaultConfig,
  globalSetup: './tests/e2e/Setup.ts'
}