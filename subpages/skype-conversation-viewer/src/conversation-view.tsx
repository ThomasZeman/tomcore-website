import {css} from 'goober';
import {h} from 'preact';
import {Container, Title} from './basic-components.js';
import {MessageView} from './message-view.js';
import {Conversation} from './types.js';
import {extractAttribute} from './util.js';

export const ConversationView = (props: { conversation: Conversation; onBack: () => void }) => {
    // Collect all full resolution images from messages
    const fullResImages = props.conversation.MessageList
        .filter(
            (msg) =>
                msg.messagetype === "RichText/UriObject" ||
                msg.messagetype === "RichText/Media_Video",
        )
        .map((msg) => {
            if (msg.messagetype === 'RichText/Media_Video') {
                return extractAttribute(msg.content, "uri") + '/views/video';
            } else {
                return extractAttribute(msg.content, "uri") + '/views/imgpsh_fullsize_anim';
            }
        })
        .filter((uri): uri is string => uri !== null);

    return (
        <Container>
            <Title>{props.conversation.displayName || props.conversation.id}</Title>
            <button
                className={css`
                    margin-bottom: 1rem;
                    padding: 0.5rem 1rem;
                    font-size: 1rem;
                    cursor: pointer;
                `}
                onClick={props.onBack}
            >
                Back
            </button>
            <div>
                {props.conversation.MessageList.map((msg) => (
                    <MessageView key={msg.id} message={msg}/>
                ))}
            </div>
            {/*<Gallery images={fullResImages} />*/}
        </Container>
    );
};
