import { USER_UPDATE_MESSAGE_TYPE, UserUpdateMessage, UserProfileMessage, USER_PROFILE_MESSAGE_TYPE } from "./messages";


export class UserData {
    // A very generic user-data class, which can hold credentials, user-name, characterDescription as well as the
    // client ID, this user is assigned to.


    constructor(
        readonly credentials: object,
        readonly userName: string | null,
        readonly characterDescription: object,
        readonly id: number | null = null, // clientId, if null, this is a request, e.g. for the initial client->server user_update message
    ) {

    }

    public toUserUpdateMessage(): UserUpdateMessage {
        return {
            type: USER_UPDATE_MESSAGE_TYPE,
            credentials: this.credentials, 
            characterDescription: this.characterDescription,
            userName: this.userName,
        } as UserUpdateMessage;
    }

    public toUserProfileMessage(): UserProfileMessage {
        return {
            type: USER_PROFILE_MESSAGE_TYPE,
            characterDescription: this.characterDescription, 
            userName: this.userName,
            id: this.id,
        } as UserProfileMessage;
    }
}