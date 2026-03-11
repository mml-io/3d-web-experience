import { CharacterDescription } from "./UserNetworkingMessages";

export type UserData = {
  userId: string;
  username: string | null;
  characterDescription: CharacterDescription | null;
  colors: Array<[number, number, number]> | null;
};
