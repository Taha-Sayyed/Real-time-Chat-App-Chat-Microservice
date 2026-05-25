import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

export const TEST_PUBLIC_KEY = publicKey;
export const TEST_PRIVATE_KEY = privateKey;

export const generateTestToken = (
  userId: string,
  extraClaims: Record<string, unknown> = {}
): string => {
  return jwt.sign(
    { user: { _id: userId, name: "Test User", email: "test@example.com" }, ...extraClaims },
    privateKey,
    { algorithm: "RS256" }
  );
};

export const generateInvalidPayloadToken = (): string => {
  return jwt.sign({ noUser: true }, privateKey, { algorithm: "RS256" });
};
