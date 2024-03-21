import { UserNetworkingServer } from "@mml-io/3d-web-user-networking";

export class CharacterRepository {

  constructor(
    private server: UserNetworkingServer,
  ) {
    // Add example characters
    this.addCharacters(); 
  }    

  addCharacters() {
      const characterA = {
        // Option 1 (Default) - Use a GLB file directly
        //meshFileUrl: defaultAvatarMeshFileUrl, // This is just an address of a GLB file
        // Option 2 - Use an MML Character from a URL
        // mmlCharacterUrl: "https://...",
        // Option 3 - Use an MML Character from a string
        mmlCharacterString: `
        <m-character src="/assets/models/bot.glb">
          <m-model src="/assets/models/hat.glb"
            socket="head"
            x="0.03" y="0" z="0.0"
            sx="1.03" sy="1.03" sz="1.03"
            rz="-90"
          ></m-model>
        </m-character>
        `,
      };
  
      const characterB = {
        // Option 1 (Default) - Use a GLB file directly
        //meshFileUrl: defaultAvatarMeshFileUrl, // This is just an address of a GLB file
        // Option 2 - Use an MML Character from a URL
        // mmlCharacterUrl: "https://...",
        // Option 3 - Use an MML Character from a string
        mmlCharacterString: `
        <m-character src="/assets/models/bot.glb">
        </m-character>
        `,
      };
  
      this.server.updateCharacter(1, characterA);
      this.server.updateCharacter(2, characterB);
    }

}