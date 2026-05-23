import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

interface IUser extends Document {
    _id: string;
    name: string;
    email: string;
}

export interface AuthenticatedRequest extends Request {
    user?: IUser | null;
}

export const isAuth = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({
                message: "Please Login - No Auth header",
            });
            return;
        }

        const token = authHeader.split(" ")[1];

        let publicKey = process.env.JWT_PUBLIC_KEY as string;

        // If the public key is base64-encoded (without PEM headers), convert it to PEM format
        if (publicKey && !publicKey.includes("-----BEGIN")) {
            const keyBuffer = Buffer.from(publicKey, "base64");
            publicKey = `-----BEGIN PUBLIC KEY-----\n${keyBuffer.toString("base64")}\n-----END PUBLIC KEY-----`;
        }

        const decodedValue = jwt.verify(
            token,
            publicKey,
            { algorithms: ["RS256"] }
        ) as JwtPayload;

        if (!decodedValue || !decodedValue.user) {
            res.status(401).json({
                message: "Invalid token",
            });
            return;
        }

        req.user = decodedValue.user;
        next();

    } catch (error) {
        res.status(401).json({
            message: "Please Login - JWT error",
        });
    }
}

export default isAuth;