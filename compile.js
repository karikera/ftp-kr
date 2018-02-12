'use strict';

const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const config = ts.parseJsonConfigFileContent(JSON.parse(fs.readFileSync('tsconfig.json', 'utf-8')), ts.sys, '.');
const program = ts.createProgram(config.fileNames, config.options);
  
function onNode(node)
{
	const typeChecker = program.getTypeChecker();
	if (!isKeysCallExpression(node, typeChecker)) return node;
	if (!node.typeArguments) return ts.createArrayLiteral([]);

	const type = typeChecker.getTypeFromTypeNode(node.typeArguments[0]);
	const properties = typeChecker.getPropertiesOfType(type);
	return ts.createArrayLiteral(properties.map(property => ts.createLiteral(property.name)));
}

function isKeysCallExpression(node, typeChecker)
{
	if (node.kind !== ts.SyntaxKind.CallExpression) return false;
	const signature = typeChecker.getResolvedSignature(node);
	if (typeof signature === 'undefined') return false;

	const { declaration } = signature;
	if (!declaration) return false;
	if (!declaration.getSourceFile().fileName.endsWith('/src/util/keys.ts')) return false;
	if (!declaration.name) return false;
	return declaration.name.getText() === 'keys';
}

function forEachAllNode(node, context, callback)
{
	return ts.visitEachChild(callback(node), childNode => forEachAllNode(childNode, context, callback), context);
}

const transformers = {
  before: [context => file => forEachAllNode(file, context, onNode)],
  after: []
};
const results = program.emit(undefined, undefined, undefined, false, transformers);
const dirnameWithSlash = __dirname + path.sep;

for (const diag of results.diagnostics)
{
	const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);

	var resolved = path.resolve(diag.file.fileName);
	if (resolved.startsWith(dirnameWithSlash)) resolved = resolved.substr(dirnameWithSlash.length);
	resolved = resolved.replace(/\\/g, '/');

	const catergory = ['warning','error','message'][diag.category];
	const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
	console.error(`${resolved}(${line},${character}): ${catergory} TS${diag.code}: ${message}`);
}
console.log('Done');
