import { CharacterDescription } from "./UserNetworkingMessages";

export type UserData = {
  readonly username: string;
  readonly characterDescription: CharacterDescription;
  readonly colors: Array<[number, number, number]>;
};
