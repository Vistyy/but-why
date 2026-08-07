import { existsSync } from "node:fs";
import { GlobalConfigValidationFailed } from "../contracts/configErrors.js";
import { formatContractDiagnostics } from "../contracts/contractDiagnostics.js";
import { decodeGlobalConfig, type GlobalConfig } from "../contracts/globalConfig.js";
import { type ConfigReadResult, readConfigDocument } from "./repoConfig.js";

export type GlobalConfigReadResult = ConfigReadResult<GlobalConfig, GlobalConfigValidationFailed>;

export const readGlobalConfig = (path: string): GlobalConfigReadResult => {
  if (!existsSync(path)) {
    return { ok: true, config: {} };
  }

  return readConfigDocument(
    path,
    decodeGlobalConfig,
    (sourcePath, diagnostics) =>
      new GlobalConfigValidationFailed({
        path: sourcePath,
        diagnostics,
        message: formatContractDiagnostics(diagnostics),
      }),
  );
};
