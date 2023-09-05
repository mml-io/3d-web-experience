import express from "express";

function decodeCredentials(authHeader: string): [string, string] {
  const encodedCredentials = authHeader.trim().replace(/Basic\s+/i, "");

  const buff = new Buffer(encodedCredentials, "base64");
  const decodedCredentials = buff.toString("utf-8");

  const split = decodedCredentials.split(":");
  return [split[0], split[1]];
}

export function authMiddleware(serverPassword: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const [username, password] = decodeCredentials(req.headers.authorization || "");

    if (password === serverPassword) {
      return next();
    }

    res.set("WWW-Authenticate", 'Basic realm="user_pages"');
    res.status(401).send("Authentication required.");
  };
}
