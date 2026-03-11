import { CharacterDescription } from "./UserNetworkingMessages";

export type UserData = {
  userId: string;
  username: string | null;
  characterDescription: CharacterDescription | null;
  colors: Array<[number, number, number]> | null;
};

/**
 * The subset of user identity fields that can be updated after the initial
 * connection. `userId` is assigned once during authentication and is immutable.
 */
export type UserIdentityUpdate = {
  username: string | null;
  characterDescription: CharacterDescription | null;
  colors: Array<[number, number, number]> | null;
};
