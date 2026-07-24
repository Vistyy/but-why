# Use release tags and a changelog for package provenance

Status: accepted

The v1 npm package uses version `0.0.1`, publishes with `private: false`, and includes a root `CHANGELOG.md` in the package candidate.
The `v0.0.1` Git tag identifies the exact source commit, while npm provenance will connect the published package to its source and build process in the publication task.
A custom `sourceCommit` field in `package.json` is rejected because Git tags and npm provenance provide the standard source mapping without adding package-specific metadata.
