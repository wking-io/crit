export const PROJECT_SKILL_RELATIVE_PATH = ".agents/skills/crit/SKILL.md"

export const projectSkillSource = `# Crit

Use the local Crit CLI against \`crit dev\`.

\`\`\`
crit layout <canvas-id>
crit add-frame <canvas-id> --type application-route --route /path --title Title --x 0 --y 0
\`\`\`

\`--type\`, \`--title\`, \`--x\`, and \`--y\` are required. \`layout\` prints current Frame and Note boxes.

Use \`application-route\` for project pages, \`web-url\` for public pages, and \`artifact\` for captures. Do not use localhost as a web-url.

People review in the Crit browser. Agents write through this CLI.
`
