# Deployment Checklist - Instagram Comment Lead Intelligence v2.0

## ✅ Pre-Deployment Verification

### Build System
- [x] TypeScript compiles without errors (`npm run build`)
- [x] No linter errors (`npm run lint`)
- [x] dist/ directory contains compiled .js files
- [x] Source maps generated (.js.map files)
- [x] Type declarations generated (.d.ts files)

### Input Schema
- [x] `.actor/input_schema.json` is valid JSON
- [x] Schema contains exactly 4 properties
- [x] `postUrls` marked as required
- [x] All optional fields have defaults
- [x] URL pattern validation configured
- [x] Min/max constraints on numeric fields

### TypeScript Types
- [x] `src/types/Input.ts` defines InputSchema
- [x] `src/types/Input.ts` defines NormalizedInput
- [x] `src/types/Input.ts` exports INPUT_DEFAULTS
- [x] `src/types/Input.ts` exports INPUT_CONSTRAINTS
- [x] `src/types/Output.ts` defines LeadOutput
- [x] All types use strict mode (no 'any')

### Runtime Code
- [x] `src/index.ts` loads input via Actor.getInput()
- [x] Input validation implemented in `src/inputValidator.ts`
- [x] Validation throws errors on missing required fields
- [x] Validation applies defaults to optional fields
- [x] Structured JSON logging configured
- [x] Fail-fast error handling implemented
- [x] Actor.exit() called in finally block

### Configuration Files
- [x] `package.json` "main" points to "dist/index.js"
- [x] `package.json` "start" runs "node dist/index.js"
- [x] `package.json` "build" runs "tsc"
- [x] `tsconfig.json` strict mode enabled
- [x] `tsconfig.json` outDir set to "./dist"
- [x] `.actor/actor.json` references correct input_schema.json
- [x] `.actor/actor.json` version is "2.0.0"

### Documentation
- [x] README.md updated with minimal schema
- [x] README.md includes input/output examples
- [x] README.md includes quick start guide
- [x] README.md documents default values
- [x] README.md includes troubleshooting section
- [x] REFACTORING_SUMMARY.md created

### Dependencies
- [x] All dependencies installed (`npm install`)
- [x] No security vulnerabilities (`npm audit`)
- [x] apify SDK version compatible
- [x] crawlee version compatible
- [x] TypeScript devDependencies present

---

## 🚀 Deployment Steps

### 1. Local Testing

```bash
# Clean build
npm run build

# Test with sample input
npm start
```

**Expected result:** Actor loads INPUT.json, validates, logs configuration, pushes sample data

### 2. Apify Platform Deployment

#### Option A: Via Apify Console

1. Navigate to [Apify Console](https://console.apify.com)
2. Click "Actors" → "Create New Actor"
3. Upload source code:
   - `.actor/` directory
   - `src/` directory
   - `dist/` directory (pre-compiled)
   - `package.json`
   - `tsconfig.json`
4. Configure build settings:
   - Dockerfile: Use default Node.js 18+
   - Build command: `npm install && npm run build`
5. Test run with sample input
6. Publish to Apify Store (optional)

#### Option B: Via Apify CLI

```bash
# Install Apify CLI
npm install -g apify-cli

# Login to Apify
apify login

# Push Actor to Apify
apify push

# Run Actor on Apify
apify call
```

### 3. Post-Deployment Validation

#### Test Cases

**Test 1: Minimal Input**
```json
{
  "postUrls": ["https://www.instagram.com/p/ABC123/"]
}
```
Expected: Uses defaults (1000 comments, 50 leads, 0.4 score)

**Test 2: Full Input**
```json
{
  "postUrls": ["https://www.instagram.com/p/ABC123/"],
  "maxCommentsPerPost": 500,
  "targetLeads": 30,
  "minLeadScore": 0.6
}
```
Expected: All values applied as specified

**Test 3: Invalid Input**
```json
{
  "postUrls": []
}
```
Expected: Error thrown, Actor exits with code 1

**Test 4: Missing Required Field**
```json
{}
```
Expected: Error: "Input field postUrls is required"

---

## 📊 Verification Checklist

### Build Artifacts
- [ ] `dist/index.js` exists
- [ ] `dist/index.js.map` exists
- [ ] `dist/index.d.ts` exists
- [ ] `dist/inputValidator.js` exists
- [ ] `dist/inputValidator.d.ts` exists
- [ ] `dist/types/Input.js` exists
- [ ] `dist/types/Input.d.ts` exists
- [ ] `dist/types/Output.js` exists
- [ ] `dist/types/Output.d.ts` exists

### Runtime Behavior
- [ ] Actor starts successfully
- [ ] Input loads from Actor.getInput()
- [ ] Validation runs before processing
- [ ] Errors are logged with ❌ emoji
- [ ] Success is logged with ✅ emoji
- [ ] Dataset receives pushed data
- [ ] Actor exits cleanly (code 0 on success)

### Schema Validation
- [ ] postUrls with valid URLs → Pass
- [ ] postUrls with invalid URLs → Warning + filtered
- [ ] postUrls empty array → Error
- [ ] maxCommentsPerPost = -1 → Clamped to 10
- [ ] maxCommentsPerPost = 99999 → Clamped to 10000
- [ ] targetLeads = 0 → Clamped to 1
- [ ] minLeadScore = 1.5 → Clamped to 1.0

---

## 🔍 Smoke Tests

### Test 1: Build from Scratch
```bash
rm -rf node_modules dist
npm install
npm run build
npm start
```
**Expected:** Clean build, no errors, sample data pushed

### Test 2: TypeScript Type Checking
```bash
npx tsc --noEmit
```
**Expected:** No type errors

### Test 3: Linting
```bash
npm run lint
```
**Expected:** No linting errors

### Test 4: Format Check
```bash
npm run format
```
**Expected:** All files formatted consistently

---

## 📦 Deployment Package Contents

### Required Files for Apify:
```
.actor/
  ├── actor.json
  └── input_schema.json
dist/                       # Pre-compiled (optional)
  ├── index.js
  ├── inputValidator.js
  └── types/
      ├── Input.js
      └── Output.js
src/                        # Source files (for reference)
  ├── index.ts
  ├── inputValidator.ts
  └── types/
      ├── Input.ts
      └── Output.ts
package.json
tsconfig.json
README.md
```

### Optional Files:
```
.eslintrc.json
.prettierrc.json
.gitignore
INPUT.json
REFACTORING_SUMMARY.md
DEPLOYMENT_CHECKLIST.md
```

---

## 🐛 Troubleshooting

### Build Fails: "Cannot find module"
**Solution:** Run `npm install` to install dependencies

### Runtime Error: "Actor.getInput() returns null"
**Solution:** Ensure INPUT.json exists or provide input via Apify Console

### TypeScript Error: "Cannot find name 'log'"
**Solution:** Ensure crawlee is installed: `npm install crawlee`

### Validation Error: "No valid Instagram URLs"
**Solution:** Check URL format matches: `https://www.instagram.com/p/ABC123/`

---

## ✅ Final Checklist

Before deploying to production:

- [x] All code committed to git
- [x] Version bumped to 2.0.0
- [x] README.md updated
- [x] CHANGELOG.md updated (optional)
- [x] No console.log() statements (use log.info() instead)
- [x] No hardcoded credentials
- [x] No TODO comments in production code
- [x] All tests passing
- [x] Build succeeds without warnings
- [x] Linter passes
- [x] Type checking passes
- [ ] Smoke test on Apify platform
- [ ] Documented API endpoints (if any)
- [ ] Performance benchmarks (optional)

---

## 🎯 Success Criteria

✅ **Build:** TypeScript compiles to dist/ without errors
✅ **Runtime:** Actor runs with minimal input
✅ **Validation:** Invalid inputs throw clear errors
✅ **Logging:** Structured JSON logs for debugging
✅ **Output:** Sample data pushed to Apify Dataset
✅ **Documentation:** README covers all use cases
✅ **Types:** 100% TypeScript type coverage
✅ **Schema:** Synchronized with runtime and types

---

## 📝 Notes

- **Backward Compatibility:** None - v2.0 is a breaking change
- **Migration Path:** Users must update input schema to v2.0 format
- **Deprecation Notice:** v1.x enterprise fields removed
- **Support:** See README.md for troubleshooting and support

---

**Generated:** 2026-02-09  
**Version:** 2.0.0  
**Status:** ✅ READY FOR DEPLOYMENT
