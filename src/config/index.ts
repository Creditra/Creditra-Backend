export interface Config {
    port: number;
    databaseUrl: string;
    featureFlags: {
        risk_v2: boolean;
        [key: string]: boolean;
    };
}

export const config: Config = {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? '',
    featureFlags: {
        risk_v2: process.env.FEATURE_RISK_V2 === 'true',
    },
};
