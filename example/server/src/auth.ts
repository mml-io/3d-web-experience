import express from "express";

function decodeCredentials(authHeader: string): [string, string] {
  const encodedCredentials = authHeader.trim().replace(/Basic\s+/i, "");

  const buff = Buffer.from(encodedCredentials, "base64");
  const decodedCredentials = buff.toString("utf-8");
  const split = decodedCredentials.split(":");
  return [split[0], split[1]];
}

export function authMiddleware(serverPassword: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (typeof req.headers["x-custom-auth"] !== undefined) {
      if (req.headers["x-custom-auth"] === serverPassword) {
        return next();
      }
    }

    // Removed the setting of the WWW-Authenticate header
    res.status(401).send("Authentication required.");
  };
}
