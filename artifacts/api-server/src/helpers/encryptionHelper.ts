import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET ?? "rasokart-secret-key-change-in-production";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(SECRET).digest();

export interface EncryptedValue {
  encrypted: string;
  iv: string;
  tag: string;
}

export function encryptValue(plaintext: string): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptValue(enc: EncryptedValue): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    Buffer.from(enc.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(enc.encrypted, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function safeDecrypt(
  encrypted: string | null | undefined,
  iv: string | null | undefined,
  tag: string | null | undefined,
): string | null {
  if (!encrypted || !iv || !tag) return null;
  try {
    return decryptValue({ encrypted, iv, tag });
  } catch {
    return null;
  }
}
