# Secret scanning

Creditra blocks accidental commits of private keys, API tokens, database URLs, and webhook secrets with a dedicated Gitleaks scan.

## CI guardrail

The `Secret Scanning` workflow downloads a pinned Gitleaks CLI release and runs:

```bash
gitleaks detect --source . --config .gitleaks.toml --no-git --redact --verbose
```

The workflow fails the pull request when a secret is found in the current repository tree. It uses the open-source CLI directly instead of the Gitleaks GitHub Action so organization repositories do not need a `GITLEAKS_LICENSE` secret just to run the guardrail.

## Local guardrail

Run the full repository scan before opening a pull request:

```bash
npm run security:secrets
```

Run a staged-only check before committing:

```bash
npm run security:secrets:staged
```

Install Gitleaks locally from the upstream releases page, or set `GITLEAKS_BIN` to the scanner executable path.

## Allowlist policy

Allowed examples must be non-deployable placeholders, such as `.env.example` values. Do not allowlist a real token after it is found. Rotate the credential, remove it from git history when necessary, and then add a narrowly scoped placeholder allowlist only if the scanner needs it.

## Remediation

1. Revoke or rotate the exposed credential immediately.
2. Remove the secret from the file and replace it with an environment variable reference.
3. If the secret reached shared history, coordinate history cleanup with maintainers.
4. Re-run `npm run security:secrets` and include the output summary in the pull request.
