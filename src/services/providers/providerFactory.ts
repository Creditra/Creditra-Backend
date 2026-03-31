import type { IRiskProvider } from "./IRiskProvider.js";
import { StaticRiskProvider } from "./StaticRiskProvider.js";
import { RulesEngineRiskProvider } from "./RulesEngineRiskProvider.js";
import {
  ExternalApiRiskProvider,
  type ExternalApiRiskProviderConfig,
} from "./ExternalApiRiskProvider.js";

export type RiskProviderName = "static" | "rules" | "external";

export function createRiskProvider(override?: RiskProviderName): IRiskProvider {
  const name: RiskProviderName =
    override ??
    (process.env["RISK_PROVIDER"] as RiskProviderName | undefined) ??
    "rules";

  switch (name) {
    case "static":
      return new StaticRiskProvider();

    case "external": {
      const cfg: ExternalApiRiskProviderConfig = {
        baseUrl: process.env["RISK_PROVIDER_API_URL"] ?? "",
        apiKey: process.env["RISK_PROVIDER_API_KEY"] ?? "",
        timeoutMs: Number(process.env["RISK_PROVIDER_TIMEOUT_MS"] ?? 5000),
      };
      return new ExternalApiRiskProvider(cfg);
    }

    case "rules":
    default:
      return new RulesEngineRiskProvider();
  }
}
