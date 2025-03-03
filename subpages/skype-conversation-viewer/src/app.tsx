import {h, render, JSX} from 'preact';
import { useState } from 'preact/hooks';
import { Container, FileInput, Title } from './basic-components.js';
import { ConversationList } from './conversation-list.js';
import { ConversationView } from './conversation-view.js';
import { Conversation, MessagesExport } from './types.js';
import { css } from 'goober';
import KofiButton from "kofi-button"

const AppInfo = () => (
    <div
        className={css`
      background: #f9f9f9;
      padding: 1rem;
      border: 1px solid #ddd;
      margin-top: 1rem;
      font-size: 0.9rem;
      color: #333;
    `}
    >
        <strong>Instructions:</strong>
        <ul>
            <li>
                <strong>Chat History Request:</strong> Use Microsoft’s official export tool to request your Skype chat history <a href={"https://secure.skype.com/en/data-export"} target="_blank" rel="noopener noreferrer">Skype Data Export</a>
            </li>
            <li>
                <strong>Unpacking:</strong> The exported file is a compressed tar archive. Unpack it using a compatible tool on your local hard drive. If unsure follow this <a href={"https://www.wikihow.com/Save-a-Text-Chat-on-Skype#:~:text=Sign%20into%20your%20Skype%20account,into%20a%20single%20downloadable%20file."} target="_blank" rel="noopener noreferrer">guide</a>
            </li>
            <li>
                <strong>Browser Login:</strong> Make sure you are logged into <a href={"https://web.skype.com"} target="_blank" rel="noopener noreferrer">web.skype.com</a> in this browser (eg. another tab). Otherwise, content such as images will not load.
            </li>
            <li>
                <strong>Note:</strong> This app runs in your <strong>browser only</strong> and does not send any data to a server.
            </li>
            <li>
                <strong>Render:</strong> Use your browser print function to save the conversation for example as PDF or print it.
            </li>
            <li>
                <strong>Project:</strong> The author of this app is Thomas Zeman. You can find the source on <a href={"https://github.com/thomaszeman/tomcore-website"} target="_blank" rel="noopener noreferrer">GitHub</a>. For any questions or feedback please use the GitHub issue tracker.
            </li>
            <li>
                <strong>No Warranty: This tool is provided "AS IS" with absolutely no warranty.</strong>
            </li>
            <li>
                <strong>License: </strong>{" "}
                <a
                    href="https://www.apache.org/licenses/LICENSE-2.0"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Apache 2.0
                </a>
            </li>
        </ul>
        <KofiButton color="#0a9396" title="Support my work" kofiID="C0C4GEP4X" />
        <p/>
        <strong>Versions:</strong>
        <ul>
            <li>03/03/2025: Initial release</li>
        </ul>
    </div>
);

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
                <Title>View Exported Skype Conversations</Title>
                <FileInput onChange={handleFileUpload} />
                <AppInfo />
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
                <AppInfo />
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

render(<App />, document.getElementById("app") as HTMLElement);
