import {css} from 'goober';
import {h} from 'preact';
import {Conversation} from './types.js';

export const ConversationList = (props: {
    conversations: Conversation[];
    onSelect: (conv: Conversation) => void;
}) => (
    <ul className={css`
        list-style: none;
        padding: 0;
    `}>
        {props.conversations.map((conv) => (
            <li
                key={conv.id}
                className={css`
                    padding: 0.75rem;
                    border: 1px solid #ddd;
                    margin-bottom: 0.5rem;
                    border-radius: 4px;
                    cursor: pointer;
                    &:hover {
                        background-color: #f0f0f0;
                    }
                `}
                onClick={() => props.onSelect(conv)}
            >
                {conv.displayName ? conv.displayName : conv.id}
            </li>
        ))}
    </ul>
);
