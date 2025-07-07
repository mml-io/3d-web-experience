import { DeltaNetServerError } from "@deltanet/delta-net-server";

export type CharacterDescription =
  | {
      meshFileUrl: string;
      mmlCharacterString?: null;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString: string;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString?: null;
      mmlCharacterUrl: string;
    };

export class UserNetworkingServerError extends DeltaNetServerError {}

export type UserIdentity = {
  characterDescription: CharacterDescription | null;
  username: string | null;
  colors: Array<[number, number, number]> | null;
};

export type ClientChatMessage = {
  message: string;
};

export type ServerChatMessage = {
  fromUserId: number;
  message: string;
};

// Custom message types
export const FROM_CLIENT_CHAT_MESSAGE_TYPE = 1;
export const FROM_SERVER_CHAT_MESSAGE_TYPE = 2;

export function parseClientChatMessage(contents: string): ClientChatMessage | Error {
  try {
    const parsed = JSON.parse(contents) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
    ) {
      return {
        message: parsed.message as string,
      };
    } else {
      throw new Error("Invalid chat message");
    }
  } catch (error) {
    return new Error(`Invalid chat message: ${error}`);
  }
}

export function parseServerChatMessage(contents: string): ServerChatMessage | Error {
  try {
    const parsed = JSON.parse(contents) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "fromUserId" in parsed &&
      typeof parsed.fromUserId === "number" &&
      "message" in parsed &&
      typeof parsed.message === "string"
    ) {
      return {
        fromUserId: parsed.fromUserId as number,
        message: parsed.message as string,
      };
    } else {
      throw new Error("Invalid server chat message");
    }
  } catch (error) {
    return new Error(`Invalid server chat message: ${error}`);
  }
}
