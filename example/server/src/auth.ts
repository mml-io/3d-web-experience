import express from "express";
import crypto from 'crypto'
import { UserData, UserNetworkingServer, UserUpdateMessage } from "@mml-io/3d-web-user-networking";
import { CharacterController } from "./CharacterControl";


export function authMiddleware(serverPassword: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (typeof req.headers["x-custom-auth"] !== undefined) {
      if (req.headers["x-custom-auth"] === serverPassword) {
        return next();
      }
    }
    res.status(401).send("Authentication required.");
  };
}

type UserPermissions = {
  allowUsername: boolean | null;
};

class UserAuthenticator {
  // This user-authenticator is intended to initially authenticating a user based on the request
  // or authenticate the user later on, e.g. when logging in during the experience. In either way, it isuses a JWT

  private sessions = new Map<string, UserData | null>();
  private permissionsBySession = new Map<string, UserPermissions>
  private sessionsByClientId = new Map<number, string>();
  private userNetworkingServer: UserNetworkingServer;


  constructor(
    // Pass verifier if user-based character verification shall be done, null otherwise
    private characterVerifier: CharacterController | null = null
  ) {
    if(characterVerifier) {
      this.characterVerifier?.registerUserAuthenticator(this);
    }
    
  }

  public generateAuthorizedSessionToken(req: express.Request): string {

    // TODO Add player authorization here
    // If no code is added, everybody with the URL can connect.

    // If it is a logged-in user experience only, check here whether the credentials provided in the request are authorized.
        
    // Could also be JWT, for simplicity, use Session-IDs
    const userId = crypto.randomBytes(20).toString('hex');
    console.log(`Generated UserId ${userId}`)
    this.sessions.set(userId, null); // Register the session-ID, but do not create a user yet
    this.setPermissions(userId, req);
    return userId;
  }

  public updateUserCharacter(userId: string, characterDescription: object) {
    this.userNetworkingServer.updateUserCharacter(this.sessions.get(userId)?.id!, characterDescription);
  }

  public registerUserNetworkServer(server: UserNetworkingServer) {
    this.userNetworkingServer = server;
  }

  public processUserUpdate(clientId: number, msg: UserUpdateMessage) : UserData | null {
    if(!this.sessionsByClientId.has(clientId)) {
      const userAuthToken = msg.credentials.USER_AUTH_TOKEN;

      if(!this.sessions.has(userAuthToken)) {
        console.error(`Invalid initial user-update for client-id=${clientId}, unknown session`);
        return null;
      }

      // From now on, the client-connection is authorized.
      this.sessionsByClientId.set(clientId, userAuthToken);
    }

    const userId = this.sessionsByClientId.get(clientId)!;
    const oldUserData = this.sessions.get(userId);  

    
    const authorizedCharacterUpdate = this.verifyCharacterUpdate(userId, msg.characterDescription);
    if(!authorizedCharacterUpdate) {
      console.error(`Unauthorized character update for client-id=${clientId}`);
      return null;
    }

    var newUsername = oldUserData?.userName ? oldUserData!.userName : `Guest #${clientId}`;
   
    if(msg.userName) {
      const authorizedUsername = this.verifyUsernameUpdate(userId, msg.userName);
      if(!authorizedUsername) {
        console.error(`Unauthorized username-update for client-id=${clientId}, username=${msg.userName}`);
      } else {
        newUsername = authorizedUsername;
      }
    } 
    
    const newUserData = new UserData(msg.credentials, newUsername, authorizedCharacterUpdate, clientId);

    this.sessions.set(userId, newUserData!);
    return newUserData!;    
  }

  public processClientDisconnect(clientId: number) {
    console.log(`Remove user-session for ${clientId}`);
    const potentialSession = this.sessionsByClientId.get(clientId);
    if(potentialSession) {
      this.permissionsBySession.delete(potentialSession);
      this.sessions.delete(potentialSession);
    }
    this.sessionsByClientId.delete(clientId);
  }

  private verifyCharacterUpdate(userId: string, characterDescription: object): object | null {
    if(!this.characterVerifier) {
      // If there's no character verifier, the client is in control over the character
      return characterDescription;
    }

    const verifiedCharacterDescription = this.characterVerifier!.getAuthorizedCharacterDescription(userId, characterDescription);
    return verifiedCharacterDescription;   
  }

  private verifyUsernameUpdate(userId: string, userName: string): string | null {
    const permissions = this.permissionsBySession.get(userId);

    if(!permissions?.allowUsername === true) {
      console.error(`No permissions to change username for ${userId}.`);
      return null;
    }

    return userName;
  }

  private setPermissions(userId: string, req: express.Request): void {
    // Add a demo permission. Only the characters of users, which have identified themselves by providing ?passphrase=supersecret
    // Will work: http://localhost:8080?character=carl&passphrase=supersecret will work
    // Will reject: http://localhost:8080?character=carl due to missing passphrase
    if(req.query?.passphrase === "ThatKillsPeople") {
      this.permissionsBySession.set(userId, {
        allowUsername: true
      })
    }

    this.characterVerifier?.setup(userId, req);
  }

  public forceUserUpdate(): void {

  }
  
}

export {UserAuthenticator};