import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const kebabCaseTag = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

function stringLiteral(node: ESTree.Node | undefined | null): string | null {
	if (node === undefined || node === null) return null;
	if (node.type === "Literal" && typeof node.value === "string") return node.value;
	if (
		node.type === "TemplateLiteral" &&
		node.expressions.length === 0 &&
		node.quasis.length === 1
	) {
		return node.quasis[0]?.value.cooked ?? null;
	}
	return null;
}

function isKebabCaseTag(name: string): boolean {
	return kebabCaseTag.test(name);
}

function propertyName(key: ESTree.Expression | ESTree.PrivateIdentifier): string | null {
	if (key.type === "Identifier") return key.name;
	return stringLiteral(key);
}

function calleeName(node: ESTree.Node): string | null {
	if (node.type === "Identifier") return node.name;
	if (node.type === "MemberExpression" && !node.computed) {
		return propertyName(node.property);
	}
	if (node.type === "CallExpression") return calleeName(node.callee);
	if (node.type === "TSInstantiationExpression") return calleeName(node.expression);
	return null;
}

function isTagKey(key: ESTree.Expression | ESTree.PrivateIdentifier): boolean {
	return propertyName(key) === "_tag";
}

function enclosingTagProperty(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (current.type === "TSPropertySignature") return isTagKey(current.key);
		if (current.type === "Property") return isTagKey(current.key);
		current = current.parent;
	}
	return false;
}

/** Ban kebab-case Effect `_tag` values so discriminants stay camelCase identifiers. */
export const noKebabCaseTagsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow kebab-case `_tag` values and TaggedStruct or TaggedError identifiers. Use camelCase.",
		},
		messages: {
			kebabCaseTag:
				"Tag `{{name}}` is kebab-case. Use a camelCase identifier.",
		},
	},
	createOnce(context) {
		const reportIfBanned = (node: ESTree.Node, name: string | null) => {
			if (name === null || !isKebabCaseTag(name)) return;
			context.report({
				node,
				messageId: "kebabCaseTag",
				data: { name },
			});
		};

		return {
			Property(node) {
				if (!isTagKey(node.key)) return;
				reportIfBanned(node.value, stringLiteral(node.value));
			},
			PropertyDefinition(node) {
				if (node.key === null || !isTagKey(node.key) || node.value === null) return;
				reportIfBanned(node.value, stringLiteral(node.value));
			},
			TSPropertySignature(node) {
				if (!isTagKey(node.key) || node.typeAnnotation === undefined) return;
				const annotation = node.typeAnnotation.typeAnnotation;
				if (annotation.type === "TSLiteralType") {
					reportIfBanned(annotation.literal, stringLiteral(annotation.literal));
				}
			},
			BinaryExpression(node) {
				if (node.operator !== "===" && node.operator !== "!==") return;
				if (node.left.type !== "MemberExpression" || node.left.computed) return;
				if (propertyName(node.left.property) !== "_tag") return;
				reportIfBanned(node.right, stringLiteral(node.right));
			},
			CallExpression(node) {
				const name = calleeName(node.callee);
				if (name !== "TaggedStruct" && name !== "TaggedError") return;
				const tag = node.arguments[0];
				if (tag === undefined) return;
				reportIfBanned(tag, stringLiteral(tag));
			},
			TSLiteralType(node) {
				if (!enclosingTagProperty(node)) return;
				reportIfBanned(node.literal, stringLiteral(node.literal));
			},
		};
	},
});
