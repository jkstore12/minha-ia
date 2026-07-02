/**
 * Jest configuration for the Minha IA project.
 *
 * Usa ts-jest com ESM para casar com o `"type": "module"` do package.json.
 * Rodar com: `node --experimental-vm-modules node_modules/jest/bin/jest.js`
 * (o script `test` em package.json ja invoca assim).
 */
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.mjs',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
    '^.+\\.mjs$': ['ts-jest', { useESM: true }],
  },
  clearMocks: true,
  verbose: true,
};

export default config;
