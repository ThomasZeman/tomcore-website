// Shell prompts such as "root@OpenWrt:~# ", "PS C:\> " or "C:\>".
const PROMPT = /^(?:[\w.-]+@[\w.-]+:\S*[#$]|PS [A-Za-z]:\\[^>]*>|[A-Za-z]:\\[^>]*>) ?/;
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?/;

// If a block shows a terminal session, only the commands are copied: prompts and output are dropped,
// while heredoc bodies and lines continued with "\" (sh) or "`" (PowerShell) stay with their command.
// Blocks without a prompt are copied as they are.
const commandsOf = (text) => {
    const lines = text.replace(/\n$/, "").split("\n").map((line) => line.replace(/\r$/, ""));
    if (!lines.some((line) => PROMPT.test(line))) {
        return text;
    }
    const commands = [];
    for (let i = 0; i < lines.length; i++) {
        const prompt = lines[i].match(PROMPT);
        if (!prompt) {
            continue;
        }
        let line = lines[i].slice(prompt[0].length);
        if (!line.trim()) {
            continue;
        }
        commands.push(line);
        while (/[\\`]$/.test(line) && i + 1 < lines.length) {
            line = lines[++i];
            commands.push(line);
        }
        const heredoc = line.match(HEREDOC);
        if (heredoc) {
            while (i + 1 < lines.length) {
                commands.push(lines[++i]);
                if (lines[i].trim() === heredoc[1]) {
                    break;
                }
            }
        }
    }
    return commands.join("\n");
};

const addCopyButtons = (clipboard) => {
    document.querySelectorAll("pre > code").forEach((codeBlock) => {
        const button = document.createElement("button");
        button.className = "copy-to-clipboard-button";
        button.type = "button";
        button.innerHTML = "📋";
        button.addEventListener("click", () => {
            clipboard.writeText(commandsOf(codeBlock.textContent)).then
            (
                () => {
                    button.innerHTML = "✔️";
                    setTimeout(() => (button.innerHTML = "📋"), 2500);
                    button.blur();
                },
                () => (button.innerHTML = "Error")
            );
        });
        const parentNode = codeBlock.parentNode;
        parentNode.parentNode.insertBefore(button, parentNode);
    });
};

if (navigator && navigator.clipboard) {
    addCopyButtons(navigator.clipboard);
}
