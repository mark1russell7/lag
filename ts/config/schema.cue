package tsconfig

import "strings"

// Config types for tsconfig
#ConfigType: "esm" | "cjs" | "commonjs" | "frontend" | "browser"

// Tsconfig schema - validates tsconfig.json structure
#Tsconfig: {
	$schema?: string
	extends?: string & strings.MinRunes(1)

	compilerOptions?: #CompilerOptions

	include?: [...string & strings.MinRunes(1)]
	exclude?: [...string & strings.MinRunes(1)]

	references?: [...#Reference]
}

#Reference: {
	path: string & strings.MinRunes(1)
}

// CompilerOptions with TypeScript 5.x options
#CompilerOptions: {
	// Type checking
	strict?:                         bool
	noImplicitAny?:                  bool
	strictNullChecks?:               bool
	strictFunctionTypes?:            bool
	strictBindCallApply?:            bool
	strictPropertyInitialization?:   bool
	strictBuiltinIteratorReturn?:    bool
	noImplicitThis?:                 bool
	useUnknownInCatchVariables?:     bool
	alwaysStrict?:                   bool
	noUnusedLocals?:                 bool
	noUnusedParameters?:             bool
	exactOptionalPropertyTypes?:     bool
	noImplicitReturns?:              bool
	noFallthroughCasesInSwitch?:     bool
	noUncheckedIndexedAccess?:       bool
	noImplicitOverride?:             bool
	noPropertyAccessFromIndexSignature?: bool
	allowUnusedLabels?:              bool
	allowUnreachableCode?:           bool

	// Modules
	module?:           string
	moduleResolution?: string
	baseUrl?:          string
	paths?: {[string]: [...string]}
	rootDir?:          string
	rootDirs?:         [...string]
	typeRoots?:        [...string]
	types?:            [...string]
	resolveJsonModule?:           bool
	resolvePackageJsonExports?:   bool
	resolvePackageJsonImports?:   bool
	allowImportingTsExtensions?:  bool
	allowArbitraryExtensions?:    bool
	verbatimModuleSyntax?:        bool

	// Emit
	declaration?:          bool
	declarationMap?:       bool
	declarationDir?:       string
	emitDeclarationOnly?:  bool
	sourceMap?:            bool
	inlineSourceMap?:      bool
	outDir?:               string
	outFile?:              string
	removeComments?:       bool
	noEmit?:               bool
	noEmitOnError?:        bool
	isolatedDeclarations?: bool
	isolatedModules?:      bool
	preserveConstEnums?:   bool
	stripInternal?:        bool

	// JavaScript support
	allowJs?:       bool
	checkJs?:       bool
	maxNodeModuleJsDepth?: number

	// Interop
	esModuleInterop?:            bool
	allowSyntheticDefaultImports?: bool
	forceConsistentCasingInFileNames?: bool

	// Language and environment
	target?:            string
	lib?:               [...string]
	jsx?:               "preserve" | "react" | "react-jsx" | "react-jsxdev" | "react-native"
	experimentalDecorators?: bool
	emitDecoratorMetadata?:  bool
	useDefineForClassFields?: bool

	// Projects
	composite?:            bool
	incremental?:          bool
	tsBuildInfoFile?:      string
	disableSourceOfProjectReferenceRedirect?: bool
	disableSolutionSearching?: bool
	disableReferencedProjectLoad?: bool

	// Completeness
	skipLibCheck?:         bool
	skipDefaultLibCheck?:  bool

	// Allow additional options for future compatibility
	...
}

// Paths for extending base configs (npm package paths)
#TsconfigPaths: {
	"esm.lib":      "@mark1russell7/cue/ts/config/esm.lib.json"
	"commonjs.lib": "@mark1russell7/cue/ts/config/commonjs.lib.json"
	frontend:       "@mark1russell7/cue/ts/config/frontend.json"
	react:          "@mark1russell7/cue/ts/config/react.json"
}

// Template for generating project tsconfig
#TsconfigTemplate: {
	_configType: #ConfigType

	output: #Tsconfig & {
		$schema: "https://json.schemastore.org/tsconfig"
		extends: #TsconfigPaths[_configType]
	}
}
