import {h, JSX} from 'preact';
import {useState} from 'preact/hooks';
import {Container, FileInput, Title} from './basic-components.js';
import {ConversationList} from './conversation-list.js';
import {ConversationView} from './conversation-view.js';
import {Conversation, MessagesExport} from './types.js';

export const App = () => {
    const [messagesExport, setMessagesExport] = useState<MessagesExport | null>(null);
    const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

    const handleFileUpload = (e: JSX.TargetedEvent<HTMLInputElement>) => {
        if (e.currentTarget.files && e.currentTarget.files[0]) {
            const file = e.currentTarget.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result;
                if (typeof text === "string") {
                    try {
                        const parsed: MessagesExport = JSON.parse(text);
                        setMessagesExport(parsed);
                    } catch (error) {
                        alert("Error parsing JSON file. Please check the file format.");
                    }
                }
            };
            reader.readAsText(file);
        }
    };

    if (!messagesExport) {
        return (
            <Container>
                <Title>Upload Skype Messages JSON</Title>
                <FileInput onChange={handleFileUpload} />
            </Container>
        );
    }

    if (!selectedConversation) {
        return (
            <Container>
                <Title>Select a Conversation</Title>
                <ConversationList
                    conversations={messagesExport.conversations}
                    onSelect={(conv) => setSelectedConversation(conv)}
                />
            </Container>
        );
    }

    return (
        <ConversationView
            conversation={selectedConversation}
            onBack={() => setSelectedConversation(null)}
        />
    );
};
