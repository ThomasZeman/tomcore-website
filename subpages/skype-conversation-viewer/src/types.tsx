export type Message = {
    id: string;
    displayName: string | null;
    originalarrivaltime: string;
    messagetype: string;
    version: number;
    content: string;
    conversationid: string;
    from: string;
    properties: any;
    amsreferences: any;
};

export type Conversation = {
    id: string;
    displayName: string | null;
    version: number;
    properties: any;
    threadProperties: any;
    MessageList: Message[];
};

export type MessagesExport = {
    userId: string;
    exportDate: string;
    conversations: Conversation[];
};
