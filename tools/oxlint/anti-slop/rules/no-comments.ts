import { defineRule } from "@oxlint/plugins";

/** Ban every source comment. Names and types have to carry the meaning. */
export const noCommentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow source comments in application TypeScript, TSX, and JavaScript.",
    },
    messages: {
      comment:
        "Source comments are banned. Rename the code so it reads without them.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
});
