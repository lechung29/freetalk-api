# CraftUI API - Development Guide

## Project Overview
Express.js API server built with TypeScript for the CraftUI project.

## Development Setup
- Install dependencies: `npm install`
- Run development server: `npm run dev`
- Build for production: `npm run build`
- Start production server: `npm start`
- Lint code: `npm run lint`

## Code Style
- TypeScript with strict mode enabled
- ESLint configured for TypeScript
- Use meaningful variable names and type annotations
- Fix linting issues with `npm run lint:fix`

## Project Structure
- `src/` - TypeScript source files
- `dist/` - Compiled JavaScript output (auto-generated)
- `.github/` - GitHub-related files and instructions

## Common Tasks
- **Add new route**: Create a route handler in `src/index.ts` or split into separate modules
- **Add dependencies**: Run `npm install <package>` then update types if needed
- **Debug**: Use `npm run dev` and check console logs
