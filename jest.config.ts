import type { Config } from 'jest';

const config: Config = {
     preset: 'ts-jest',
     testEnvironment: 'node',
     roots: ['<rootDir>/tests'],
     transform: {
          '^.+\\.ts$': [
               'ts-jest',
               {
                    useESM: true,
               },
          ],
     },
     extensionsToTreatAsEsm: ['.ts'],
     moduleNameMapper: {
          '^(\\.{1,2}/.*)\\.js$': '$1',
     },
     collectCoverage: true,
     coverageDirectory: 'coverage',
};

export default config;