import { validateCandidateRepoConfig } from "../src/repositoryRuntime/validateCandidateRepoConfig.js";

const result = validateCandidateRepoConfig(process.cwd());
if (!result.ok) {
  process.stderr.write(`${result.message}\n`);
  process.exitCode = 1;
}
