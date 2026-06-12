# Security Policy

We take the security of Creditra Backend seriously. This document
describes how to report vulnerabilities and what to expect when you do.

## Reporting a vulnerability

Please **do not** open public GitHub issues for suspected vulnerabilities.
Instead, report them privately so we can investigate and ship a fix before
disclosure.

1. Open a private security advisory via GitHub:
   <https://github.com/Creditra/Creditra-Backend/security/advisories/new>
2. Include as much detail as possible:
   - A clear description of the issue and its impact.
   - Steps to reproduce, including any required environment.
   - Proof-of-concept code or commands, if available.
   - Whether the report has already been shared with third parties.

If you cannot use GitHub's advisory flow, contact the maintainers through
the channels listed in the repository `README.md`.

## What to expect

- **Acknowledgement** within five business days.
- **Initial assessment** within ten business days of acknowledgement.
- **Coordinated disclosure** once a fix has been released, including
  credit to the reporter (unless they request otherwise).

## Out of scope

The following are intentionally out of scope for this policy:

- Vulnerabilities in third-party services we integrate with (please
  report those directly to the affected vendor).
- Denial-of-service issues that require unrealistic traffic levels.
- Reports based solely on automated scanner output without a working
  proof of concept.

## Supported versions

This repository is under active development; only the default branch
(`main`) receives security fixes. There are no maintained release
branches at this time.
