/** Fronteira do adaptador. A API é conferida no Foundry real; o núcleo tem tipos próprios estritos. */
declare const foundry: any;
declare const game: any;
declare const ui: any;
declare const Hooks: any;
declare const Actor: any;
declare const JournalEntry: any;
declare const ChatMessage: any;
declare const Roll: any;
declare function fromUuid(uuid: string): Promise<any>;
