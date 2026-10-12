import { writeFile } from "node:fs/promises";
import { renderToolDictionary } from "../integration/workspace-agent/tool-dictionary.js";

await writeFile("docs/engineering/workspace-agent-tools.md", await renderToolDictionary());
