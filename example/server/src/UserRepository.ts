import { FromServerMessage, USER_UPDATE, UserCredentialsMessage, UserNetworkingServer, UserUpdateMessage } from "@mml-io/3d-web-user-networking";
import { CharacterRepository } from "./CharacterRepository";

export class UserRepository {

  constructor(
    private server: UserNetworkingServer,
    private characterRepository: CharacterRepository
  ) {
    console.log("Initialize UserRepo");
    server.setUserCredentialHandler(this.handleUserCredentials);
  }    

  handleUserCredentials(id: number, credentialMessage: UserCredentialsMessage): UserUpdateMessage {
    //TODO check login
    // Assign character
    // assign user name

   const characterId = 1 + (id %2); // id % 2; // either 0 or 1

   const userUpdateMessage = {
    type: USER_UPDATE,
    characterId: characterId
  } as UserUpdateMessage;
   console.log(`UserID ${id} will use character ${characterId}`);

   return userUpdateMessage;
  }
}