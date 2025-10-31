# Contributing to Openotex

First off, thank you for considering contributing to Openotex! It's people like you that make Openotex such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title** for the issue to identify the problem.
* **Describe the exact steps which reproduce the problem** in as many details as possible.
* **Provide specific examples to demonstrate the steps**.
* **Describe the behavior you observed after following the steps** and point out what exactly is the problem with that behavior.
* **Explain which behavior you expected to see instead and why.**
* **Include screenshots and animated GIFs** if possible.
* **Include your environment details**: OS version, Openotex version, LaTeX distribution, etc.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title** for the issue to identify the suggestion.
* **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
* **Provide specific examples to demonstrate the steps** or point to similar implementations in other applications.
* **Describe the current behavior** and **explain which behavior you expected to see instead** and why.
* **Explain why this enhancement would be useful** to most Openotex users.

### Pull Requests

* Fill in the required template
* Do not include issue numbers in the PR title
* Follow the TypeScript and React style guides
* Include screenshots and animated GIFs in your pull request whenever possible
* End all files with a newline
* Avoid platform-dependent code

## Development Setup

### Prerequisites

* Node.js (v18 or higher)
* npm or yarn
* Git
* LaTeX distribution (for testing)

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/Openotex.git
   cd Openotex
   ```

3. **Add the upstream repository** as a remote:
   ```bash
   git remote add upstream https://github.com/FH-Prevail/Openotex.git
   ```

4. **Install dependencies**:
   ```bash
   npm install
   ```

5. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/my-feature
   # or
   git checkout -b fix/my-bugfix
   ```

### Running the Development Server

```bash
npm run dev
```

This will start:
- Webpack dev server for the renderer process (port 3000)
- Webpack in watch mode for the main process
- Electron application

### Building

```bash
npm run build
```

### Testing Your Changes

Before submitting a pull request:

1. Test your changes thoroughly
2. Ensure the application builds without errors
3. Test on different platforms if possible (Windows, macOS, Linux)
4. Check that existing features still work correctly

## Style Guidelines

### Git Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line
* Consider starting the commit message with an applicable emoji:
  * 🎨 `:art:` when improving the format/structure of the code
  * 🐛 `:bug:` when fixing a bug
  * ✨ `:sparkles:` when adding a new feature
  * 📝 `:memo:` when writing docs
  * 🚀 `:rocket:` when improving performance
  * ✅ `:white_check_mark:` when adding tests
  * 🔒 `:lock:` when dealing with security
  * ⬆️ `:arrow_up:` when upgrading dependencies
  * ⬇️ `:arrow_down:` when downgrading dependencies
  * ♻️ `:recycle:` when refactoring code

### TypeScript Style Guide

* Use TypeScript for all new code
* Follow the existing code style in the project
* Use meaningful variable and function names
* Add comments for complex logic
* Define proper types and interfaces
* Avoid `any` type when possible
* Use async/await instead of callbacks when possible

### React Style Guide

* Use functional components with hooks
* Keep components small and focused
* Use meaningful component names
* Extract reusable logic into custom hooks
* Use proper prop types
* Avoid inline styles; use CSS classes instead

### CSS Style Guide

* Use CSS variables for colors and common values
* Follow BEM naming convention when appropriate
* Keep selectors simple and specific
* Group related properties together
* Add comments for complex styles

## Project Structure

```
Openotex/
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # React renderer process
│   │   ├── components/    # React components
│   │   ├── styles/        # CSS stylesheets
│   │   └── App.tsx        # Main app component
│   └── types/             # TypeScript type definitions
├── assets/                # Application assets
├── webpack.main.config.js # Webpack config for main process
├── webpack.renderer.config.js # Webpack config for renderer
└── package.json
```

## Pull Request Process

1. **Update the README.md** with details of changes if applicable
2. **Update documentation** if you're changing functionality
3. **Follow the existing code style** and conventions
4. **Test your changes** thoroughly
5. **Write meaningful commit messages**
6. **Reference any related issues** in your PR description
7. **Wait for review** - a maintainer will review your PR and may request changes

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

## Recognition

Contributors will be recognized in the project's README and release notes.

Thank you for contributing to Openotex! 🎉
