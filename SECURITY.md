# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The Openotex team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

### How to Report a Security Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to the project maintainers. If you don't have a security contact, you can open a private security advisory on GitHub.

Include the following information in your report:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

After you submit a report, we will:

1. **Acknowledge** receipt of your vulnerability report within 48 hours
2. **Assess** the vulnerability and determine its impact and severity
3. **Develop** a fix and release plan
4. **Release** a security patch as soon as possible
5. **Credit** you for the discovery (unless you prefer to remain anonymous)

### Security Update Process

1. Security patches will be released as soon as possible after confirmation
2. A security advisory will be published on GitHub
3. Users will be notified through our communication channels
4. The vulnerability will be documented in our CHANGELOG

## Security Best Practices for Users

To keep your Openotex installation secure:

1. **Keep Updated**: Always use the latest version of Openotex
2. **Enable Auto-Updates**: Enable automatic update checking in the application
3. **Trusted Sources**: Only download Openotex from official sources (GitHub releases, openotex.com)
4. **LaTeX Packages**: Be cautious when installing LaTeX packages from unknown sources
5. **File Permissions**: Ensure your project files have appropriate permissions
6. **Review Code**: If using templates or packages from third parties, review them before use

## Known Security Considerations

### LaTeX Command Execution
- Openotex executes LaTeX commands on your system
- Only compile LaTeX documents from trusted sources
- Be aware that malicious LaTeX code can potentially access your file system

### Auto-Installation of Packages
- The automatic package installation feature downloads packages from CTAN
- Packages are installed through your LaTeX distribution's package manager
- Only install packages you trust

### Network Requests
- Openotex checks for updates by connecting to openotex.com
- This can be disabled in the settings
- No personal data is transmitted during update checks

## Security Hall of Fame

We maintain a hall of fame to acknowledge security researchers who have responsibly disclosed vulnerabilities:

<!-- This section will be updated as vulnerabilities are reported and fixed -->

_No vulnerabilities have been reported yet._

## Policy Updates

This security policy may be updated from time to time. Significant changes will be announced through our standard communication channels.

Last updated: 2025-01-XX
