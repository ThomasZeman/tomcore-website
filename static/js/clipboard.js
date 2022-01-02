const addCopyButtons = (clipboard) => {
    document.querySelectorAll("pre > code").forEach((codeBlock) => {
        const button = document.createElement("button");
        button.className = "copy-to-clipboard-button";
        button.type = "button";
        button.innerHTML = "📋";
        button.addEventListener("click", () => {
            clipboard.writeText(codeBlock.innerText).then
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