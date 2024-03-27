import { CharacterDescription } from "@mml-io/3d-web-client-core/build/character/Character";
import defaultAvatarMeshFileUrl from "../../assets/models/bot.glb";


export class CharacterRepository {
    private characters = new Map<string, CharacterDescription>();

    constructor() {
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
        meshFileUrl: defaultAvatarMeshFileUrl, // This is just an address of a GLB file
        // Option 2 - Use an MML Character from a URL
        // mmlCharacterUrl: "https://...",
        // Option 3 - Use an MML Character from a string
        // mmlCharacterString: `
        // <m-character src="/assets/models/bot.glb">
        // </m-character>
        // `,
        };

        this.registerCharacter("DEFAULT", characterB);

        this.registerCharacter("carl", characterA); // Carl wears a hat
        this.registerCharacter("manny", characterB); // corresponds to UE5 Mannequin "Manny"
    }

    public registerCharacter(name: string, characterDescription: CharacterDescription) {
        this.characters.set(name.toLowerCase(), characterDescription)
    }

    public getCharacterDescription(name: string): CharacterDescription {
        var toReturn = this.characters.get(name.toLowerCase());
        if(!toReturn) {
            console.log(`Requested unknown character '${name}', defaulting`)
            toReturn = this.getDefault();
        }
        return toReturn!;
    }

    public getDefault(): CharacterDescription {
        // Not really clean, since default may be missing as well - but good enough for MVP
        return this.characters.get("default")!;
    }

}