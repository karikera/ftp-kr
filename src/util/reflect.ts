import type * as ts from 'typescript';

export function keys(
	ctx: ts.TransformationContext,
	typeChecker: ts.TypeChecker,
	type: ts.Type
): ts.ArrayLiteralExpression {
	const factory = ctx.factory;
	const properties: string[] = [];
	function readProperties(type: ts.Type): void {
		if (type.isClassOrInterface()) {
			const baseTypes = typeChecker.getBaseTypes(type);
			for (const base of baseTypes) {
				readProperties(base);
			}
		}
		for (const prop of typeChecker.getPropertiesOfType(type)) {
			properties.push(prop.name);
		}
	}

	readProperties(type);
	return factory.createArrayLiteralExpression(
		properties.map((property) => factory.createStringLiteral(property))
	);
}
