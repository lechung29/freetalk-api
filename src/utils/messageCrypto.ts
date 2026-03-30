/** @format */

import crypto from "crypto";

export interface IMessageAttachment {
    fileName: string;
    mimeType: string;
    size: number;
    dataUrl: string;
}

export interface IMessageBody {
    text: string;
    attachment: IMessageAttachment | null;
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
    const secret = process.env.MESSAGE_ENCRYPTION_SECRET || process.env.JWT_SECRET || "dev-message-secret";
    return crypto.createHash("sha256").update(secret).digest();
}

export function encryptMessageBody(body: IMessageBody): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });

    const raw = JSON.stringify(body);
    const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptMessageBody(rawValue: string): IMessageBody {
    try {
        const buffer = Buffer.from(rawValue, "base64");

        if (buffer.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
            return {
                text: rawValue,
                attachment: null,
            };
        }

        const iv = buffer.subarray(0, IV_LENGTH);
        const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
        const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

        const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
        const parsed = JSON.parse(decrypted) as IMessageBody;

        return {
            text: typeof parsed.text === "string" ? parsed.text : "",
            attachment: parsed.attachment ?? null,
        };
    } catch {
        return {
            text: rawValue,
            attachment: null,
        };
    }
}

type DecryptableMessageDoc = {
    content: string;
    isDeleted?: boolean;
    replyTo?: any;
    attachment?: IMessageAttachment | null;
    [key: string]: any;
};

export function decryptMessageDocument<T extends DecryptableMessageDoc>(doc: T): T {
    if (!doc || typeof doc !== "object") return doc;

    const next: T = {
        ...doc,
    };

    if (doc.isDeleted) {
        next.content = "";
        next.attachment = null;
    } else {
        const body = decryptMessageBody(doc.content);
        next.content = body.text;
        next.attachment = body.attachment;
    }

    if (next.replyTo && typeof next.replyTo === "object") {
        next.replyTo = decryptMessageDocument(next.replyTo);
    }

    return next;
}

export function buildEncryptedMessageContent(text: string, attachment: IMessageAttachment | null) {
    return encryptMessageBody({
        text,
        attachment,
    });
}
