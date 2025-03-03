import { h, Fragment } from 'preact';

const emoticonMap: { [key: string]: string } = {
    "relieved": "😌",
    "worry": "😟",
    "gingerkeepfit": "🏋️",
    "yotm": "🤔",
    "batsmile": "😊",
    "porgsurprised": "😮",
    "sparklingheart": "💖",
    "hearteyes": "😍",
    "heart": "❤️",
    "hungrycat": "😺",
    "sloth": "🦥",
    "lizard": "🦎",
    "snake": "🐍",
    "unicornhead": "🦄",
    "orangutanscratching": "🙊",
    "bunnyhug": "🐰",
    "lovebites": "😘",
    "lamb": "🐑",
    "rockchick": "🤘",
    "snegovik": "⛄",
    "1f991_squid": "🦑",
    "wave": "👋",
    "hi": "👋",
    "emo": "👋",
};

interface EmoticonViewerProps {
    content: string;
}

/**
 * EmoticonViewer parses the given content string and replaces any
 * occurrences of Skype’s custom <ss type="...">(fallback)</ss> tags with
 * the corresponding emoji.
 */
export const EmoticonViewer = ({ content }: EmoticonViewerProps) => {
    const parts: preact.ComponentChildren[] = [];
    // Regular expression to match <ss type="...">(text)</ss>
    const regex = /<ss\s+type="([^"]+)">([^<]+)<\/ss>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
        // Push any text before this match
        if (match.index > lastIndex) {
            parts.push(content.substring(lastIndex, match.index));
        }
        const type = match[1];
        // Use mapped emoji; if not found, fall back to the inner text.
        const emoji = emoticonMap[type] || match[2];
        // Wrap the emoji in a span (could also add styling or an image here)
        parts.push(<span>{emoji}</span>);
        lastIndex = regex.lastIndex;
    }
    // Push any remaining text after the last match
    if (lastIndex < content.length) {
        parts.push(content.substring(lastIndex));
    }

    return <Fragment>{parts}</Fragment>;
};
