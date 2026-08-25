import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const kebabCaseKey = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const allowedKebabPrefix = /^(?:data|aria|x)-/;

function quotedName(node: ESTree.Expression | ESTree.PrivateIdentifier): string | null {
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

function isBannedKebabKey(name: string): boolean {
	return kebabCaseKey.test(name) && !allowedKebabPrefix.test(name);
}

/** Ban kebab-case TypeScript type member names so tags stay camelCase identifiers. */
export const noKebabCaseKeysRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow kebab-case TypeScript type member names. Use camelCase identifiers so keys do not need quoting.",
		},
		messages: {
			kebabCaseKey:
				"Type member `{{name}}` is kebab-case. Use a camelCase identifier so the key does not need quoting.",
		},
	},
	createOnce(context) {
		const reportIfBanned = (node: ESTree.Expression | ESTree.PrivateIdentifier) => {
			const name = quotedName(node);
			if (name === null || !isBannedKebabKey(name)) return;
			context.report({
				node,
				messageId: "kebabCaseKey",
				data: { name },
			});
		};

		return {
			TSPropertySignature(node) {
				reportIfBanned(node.key);
			},
			TSMethodSignature(node) {
				reportIfBanned(node.key);
			},
		};
	},
});
