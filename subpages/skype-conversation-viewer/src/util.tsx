import {h} from 'preact';
import {EmoticonViewer} from './emoticon-viewer.js';

/**
 * Extracts a specific attribute value from the given content string.
 */
export const extractAttribute = (content: string, attr: string): string | null => {
    const regex = new RegExp(`${attr}="([^"]+)"`);
    const match = regex.exec(content);
    return match ? match[1] : null;
};

export const decodeHTMLEntities = (text: string): string => {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
};

export const parseRichText = (content: string): preact.ComponentChildren[] => {
    const decoded = decodeHTMLEntities(content);
    const result: preact.ComponentChildren[] = [];
    const anchorRegex = /<a\s+href="([^"]+)">([^<]+)<\/a>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = anchorRegex.exec(decoded)) !== null) {
        // Process any text before the anchor tag with EmoticonViewer
        if (match.index > lastIndex) {
            result.push(<EmoticonViewer content={decoded.substring(lastIndex, match.index)} />);
        }
        result.push(<a href={match[1]} target="_blank" rel="noopener noreferrer"><EmoticonViewer content={match[2]} /></a>);
        lastIndex = anchorRegex.lastIndex;
    }

    if (lastIndex < decoded.length) {
        result.push(<EmoticonViewer content={decoded.substring(lastIndex)} />);
    }
    return result;
};
