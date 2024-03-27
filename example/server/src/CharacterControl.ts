import { Request } from 'express';
import { JSDOM } from 'jsdom';
import crypto from 'crypto'
import { UserAuthenticator } from './auth';


class CharacterInventoryItem {
    public readonly uid: string;
    private owners = new Set<string>();
    private freeForAll: boolean = false;

    constructor(
        private characterController: CharacterController,
        public readonly src: string | null = null,
        public readonly id: string | null = null,
        // Indicates this can only exist in one inventory
        public readonly uniqueItem: boolean = false) {
            // Compute a uid
            if(id) {
                this.uid = id;
            } else if(this.src) {
                this.uid = this.src;
            } else {
                this.uid = crypto.randomBytes(20).toString('hex');
            }
    }


    public transferOwnership(userId: string) {
        console.log(`Transfer ownership of ${this.uid} to ${userId}`)
        if(this.uniqueItem) {
            for(let currentOwner of this.owners.values()) {
                this.removeOwner(currentOwner);
            }
        }
        this.addOwner(userId);
    }


    public addOwner(userId: string) {
        if(this.uniqueItem) {
            if(this.owners.size > 0) {
                throw `Unique item already owned. Cannot add owner ${userId} to inventory item ${this.uid}.`
            }
        }
        // indempotent approach
        if(!this.owners.has(userId)) {
            console.log(`${userId} now owns ${this.uid}`);
            this.owners.add(userId);
            this.notify(userId);
        }
    }

    public setFreeForAll(value: boolean) {
        this.freeForAll = value;

    }

    public removeOwner(userId: string) {
        if(this.owners.has(userId)) {
            this.owners.delete(userId);
            this.notify(userId);
        }
    }

    public isOwner(userId: string): boolean {
        return this.owners.has(userId) || ((!this.uniqueItem) && this.freeForAll);
    }

    private notify(userId:string) {
        this.characterController.onOwnershipChange(userId, this);
    }
}


// This shall only exist ones and holds all globally available inventory items
class InventoryItems {
    private inventoryByUid = new Map<string, CharacterInventoryItem>();
    private inventoryBySrc = new Map<string, Set<CharacterInventoryItem>>();
  
    constructor() {
        
    }

    public addInventoryItem(inventoryItem: CharacterInventoryItem) {
        if(this.inventoryByUid.has(inventoryItem.uid)){ 
            console.warn(`Tried to add existing inventory item uid=${inventoryItem.uid}`);
            return;
        }
        this.inventoryByUid.set(inventoryItem.uid, inventoryItem);

        const src = inventoryItem.src!;
        if(!this.inventoryBySrc.has(src)) {
            this.inventoryBySrc.set(src, new Set<CharacterInventoryItem>());
        }

        this.inventoryBySrc.get(src)!.add(inventoryItem);
    }

    public inventoryItemById(id: string): CharacterInventoryItem | undefined {
        return this.inventoryByUid.get(id);
    }

    public canUseSrc(userId: string, src:string ): boolean {

        const inventoryItems = this.inventoryBySrc.get(src);
        if(!inventoryItems) {
            console.error(`user ${userId} cannot use src=${src}`);
            return false;
        }

        for(let inventoryItem of inventoryItems) {
            const isOwner =  inventoryItem.isOwner(userId);
            if(isOwner) {
                return true;
            }
        }
        console.error(`user ${userId} cannot use src=${src}`);
        return false;
    }
}


type MyCharacterDescription = {
    mmlCharacterString?: string
}


class CharacterController {
    // Verifies character updates
    // Manages inventory, in particular when there are unique objects, s.t. if they are added to the inventory of one character
    // they are removed from another character's inventory.

    // In general, each user has an empty inventory, i.e. does not own anything
    // You can specify certain items in defineItems() and modify them with setFreeForAll(true),
    // s.t. they can be used in characterDescriptions for every player.
    
    // refer setup() and defineItems() for further details

    private allItems = new InventoryItems();
    private userAuthenticator: UserAuthenticator;
    private currentCharacters = new Map<string, MyCharacterDescription>;

    constructor() {
        this.defineItems();        
    }

    // This removes any mml-tags using src attributes
    // that are not permitted for the user
    public getAuthorizedCharacterDescription(userId: string, characterDescription: object): object | null {
        const typedCharacterDescription = characterDescription as MyCharacterDescription;
        const mmlCharacterString = typedCharacterDescription.mmlCharacterString ?? null;
        
        if(mmlCharacterString === null) {
            // If there is no character string, consider it valid
            return characterDescription;
        }

        const dom = new JSDOM(mmlCharacterString!);
        const doc = dom.window.document;

        for(let element of doc.querySelectorAll('*')) {
            const src = element.getAttribute('src');
            if(src) {
                if(!this.allItems.canUseSrc(userId, src!)) {
                    console.warn(`Remove ${src} from character: Not permitted for user ${userId}`);
                    element.parentNode?.removeChild(element);
                }
            }        
        }

        const newCharacterDescription = {mmlCharacterString: doc.body.innerHTML};
        // set it here
        this.currentCharacters.set(userId, newCharacterDescription);
        return newCharacterDescription;
    }


    public registerUserAuthenticator(userAuthenticator: UserAuthenticator) {
        this.userAuthenticator = userAuthenticator;
    }

    public onOwnershipChange(userId: string, inventoryItem: CharacterInventoryItem) {
        // only if ownership is removed, the server needs to get active
        if(!inventoryItem.isOwner(userId)) {
            console.log(`Ownership revoked for ${userId} from ${inventoryItem.uid}`);

            const lastSeenCharacter = this.currentCharacters.get(userId);

            if(!lastSeenCharacter) {
                // this should never happen, yet some racing conditions seem to occur
                // especially when browsers query the webservice already while the user is entering the URL
                // And setup() is executed
                console.warn(`No characterDescription known for ${userId}`);
                return;
            }

            // verify the character
            const newCharacter = this.getAuthorizedCharacterDescription(userId, lastSeenCharacter!);

            if(newCharacter != lastSeenCharacter) {
                if(!this.userAuthenticator) {
                    console.log('Cannot enforce ownership change, no UserNetworkingServer registered.')
                }
                this.userAuthenticator.updateUserCharacter(userId, newCharacter!);
            } 
        }       
    }

    public setup(userId: string, req: Request) {
        // This method is called *before* shipping 
        // the Client-Code to the requesting connection. 
        // So the user is already set up, before the client starts loading/rendering or can send any messages.

        // Add setup logic here, e.g. query blockchain based on credentials, redeem one-time codes etc.
        // For demo, we allow a user to update a character wearing a hat (client-side specified via get-parameter ?character=carl), 
        // only when the passphrase for character 'carl', namely "ThatKillsPeople" is provided
        // Hint the 2009 "Llamas with Hats" meme ;)

        // We empathize such passphrases are hardly a secure approach but shall merily illustrate the authentication flow.
        // Replace this through a proper, secure authentication protocol.
        if(req.query?.passphrase === "ThatKillsPeople") {
            this.allItems.inventoryItemById('this-is-my-uid')?.transferOwnership(userId);
        }
    }

    private defineItems() {
        // Create the bot as an item. The 3D-Model at /assets/models/bot.glb bot can be used by multiple players simultanously
        const bot = new CharacterInventoryItem(this, "/assets/models/bot.glb");
        // The standard bot can be used by all players
        bot.setFreeForAll(true);
        this.allItems.addInventoryItem(bot);

        // The hat is an example of a unique item, which can only exist once on the entire server.
        // Meaning the 3D-Model at /assets/models/hat.glb can be used by at most one player simultanously.
        // If User A attaches this hat to his character and later 
        // User B updates his character to wear the hat, the hat is revoked from User A and transferred to User B.
        // 
        // This is usually permissioned and e.g. by evaluating NFT ownership, ownership in a centralized database, 
        // a passphrase (as in this demo), a one-time code (e.g. Secure Unique NFC (NFC SUN)) etc.
        // It has a uid "this-is-my-uid", which may be any type of identifier. This could be either
        //   - a random UID
        //   - an integer ID
        // 
        //   - In combination with NFTs (ERC-721), usually a stringified or hashed version of {chainId, smartContractAddress, tokenId}.
        //     We propose to generate identifiers as (`${chainId}/${smartContractAddress}/${tokenId}`).
        //     Example "137/0xa257b5f7bc9a7058a6c1b33eeafade5b811f101d/6" [which serves MML through "mml" in MetaData] 
        //     corresponds to tokenId 6 of a polygon-pos (chain ID 137) SmartContract at 
        //     https://polygonscan.com/address/0xa257b5f7bc9a7058a6c1b33eeafade5b811f101d
        const hat = new CharacterInventoryItem(this, "/assets/models/hat.glb", "this-is-my-uid", true);
        this.allItems.addInventoryItem(hat);
    }   
}


export {CharacterController};