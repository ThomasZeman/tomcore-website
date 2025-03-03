import {css} from 'goober';
import {h} from 'preact';
import {Message} from './types.js';
import {decodeHTMLEntities, extractAttribute, parseRichText} from './util.js';

const messageItem = css`
    margin-bottom: 1rem;
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
`;

const senderStyle = css`
    font-weight: bold;
    margin-bottom: 0.25rem;
    font-size: 0.9rem;
    color: #555;
`;

export const MessageView = ({message}: { message: Message }) => {
    const time = new Date(message.originalarrivaltime).toLocaleString();

    if (message.messagetype === "Text") {
        return (
            <div className={messageItem}>
                <div className={senderStyle}>
                    {message.displayName || message.from} at {time}
                </div>
                <div>{message.content}</div>
            </div>
        );
    }

    if (message.messagetype === "RichText") {
        return (
            <div className={messageItem}>
                <div className={senderStyle}>
                    {message.displayName || message.from} at {time}
                </div>
                <div>{parseRichText(message.content)}</div>
            </div>
        );
    }

    if (message.messagetype === "RichText/UriObject") {
        const fullUri = extractAttribute(message.content, "uri");
        const thumbnail = extractAttribute(message.content, "url_thumbnail");
        if (thumbnail && fullUri) {
            return (
                <div className={messageItem}>
                    <div className={senderStyle}>
                        {message.displayName || message.from} at {time}
                    </div>
                    <img src={thumbnail} alt="Media thumbnail" className={css`max-width: 100%;`}/>
                </div>
            );
        }
    }

    if (message.messagetype === "RichText/Media_Video") {
        const fullUri = extractAttribute(message.content, "uri");
        const thumbnail = extractAttribute(message.content, "url_thumbnail");
        if (thumbnail && fullUri) {
            return (
                <div className={messageItem}>
                    <div className={senderStyle}>
                        {message.displayName || message.from} at {time}
                    </div>
                    <img src={thumbnail} alt="Media thumbnail" className={css`max-width: 100%;`}/>
                </div>
            );
        }
    }

    // none of the above, just show the event
    return (
        <div className={messageItem}>
            <div className={senderStyle}>
                {message.displayName || message.from} at {time}
            </div>
            <div>
                <em>{message.messagetype} event occurred</em>
                {message.content && (
                    <div style={{marginTop: "0.5rem", fontSize: "0.9rem", color: "#666"}}>
                        Details: {decodeHTMLEntities(message.content)}
                    </div>
                )}
            </div>
        </div>
    );
};
