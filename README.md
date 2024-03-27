# (MML) 3D Web Experience

This repository contains packages used to run a web-based, multi-user 3D web experience that
supports [MML (Metaverse Markup Language)](https://mml.io/). This repository includes two published
packages:

- [`@mml-io/3d-web-client-core`](./packages/3d-web-client-core) - A package that implements the main
  components of a 3D web experience.
- [`@mml-io/3d-web-user-networking`](./packages/3d-web-user-networking) - A package that contains
  WebSocket server and client implementations that synchronize user positions.

There is an example implementation of a 3D web experience in the `examples` directory. This example
contains:

- `web-client`
  - A THREE.js 3D experience utilizing the `@mml-io/3d-web-client-core` and
    `@mml-io/3d-web-user-networking` packages to create a multi-user 3D web client that connects to
    the server.
- `server`
  - A server which serves the `web-client` and handles user networking WebSocket connections with
    `@mml-io/3d-web-user-networking`
  - Additionally, the server runs MML documents in the `mml-documents` directory which are then
    connected to by the `web-client`.
  - A simplistic [User-System](#user-system) allowing Authorization, usernames and different MML-Characters with (permissioned) inventory for global and unique items. This is easily adapted to centralized databases and NFT-based blockchain-applications. 

It can be easily deployed to environments that support Node.js and expose ports to the internet.

<img src="./playground.jpg">

## Main features

- Multiple users can connect to the experience using just a web browser.

- Users can interact simultaneously with the stateful MML documents.

- Easy to deploy and extend with interactive MML content.

## Running locally

Making sure you have Node.js installed, run the following from the root of the repository:

```bash
npm install
npm run iterate
```

Once the example server is running, open `http://localhost:8080` in your browser.

## User-System
- Each connected client is assigned a randomly generated user-id. The user-id is "hardcoded" into each shipped client, allowing to identify a particular client at any time.
- Main Features
   - User authorization and setup is done prior to shipping the web-client package to the requesting connection.
   - There is a server-side User-Registry, managing the permissions and inventory (e.g. permissiable `m-models` in a CharacterDescription) of each user
  - Updates on Username, Characters etc. are client-side initiated and server-side verified for security reasons before being distributed to all other clients. 
  - Server-side initiated UserUpdates are possible

### Demo walkthrough
1. In a separate Browser-Tab, open http://localhost:8080. You spawn as a bot with username `Guest #`
1. In a separate Browser-Tab, open http://localhost:8080?character=carl&passphrase=ThatKillsPeople&username=MyUsername spawns a bot wearing a hat (this is the configuration of character `carl`)
   - You should see the bot from Step 1
   - You should be able to move around with the bot wearing the hat-
1. In a separate Browser-Tab, open http://localhost:8080?character=carl&passphrase=ThatKillsPeople&username=SomebodyElse
   - The just connected user `SomebodyElse` now wears the hat.
   - You should be able to run around with the bot wearing the hat in this browser tab.
   - The previous user `MyUsername` from Step 2 has lost the hat. (Because the hat is a unique item and has been transferred)
   - At this point, you should see the avatars as displayed the picture above.
1. Permission violation case: In another separate Browser-Tab, open http://localhost:8080?character=carl
   - Although you provided character=carl, which is supposed to wear a hat, you spawn as a bot without a hat and the hat is still at user `SomebodyElse`
   - This is because the passphrase was not provided, hence you are not permitted to use a hat on your character. See authorization protocol below for further details and configuration options.
   - The server logs a message accordingly, i.e. `Remove /assets/models/hat.glb from character: Not permitted for user f4be6b7fcd7c311b778bfee5975dcce2393dfd76`
   

### Authorization- and user-update protocol
1. When http://localhost:8080 is opened, a unique `UserId` generated and assigned to the open connection. 
1. [The UserAuthenticator.setPermissions() method](example/server/src/auth.ts) is called. Set up your permission system here.
1. If a CharacterController is used, the [CharacterController.setup()](example/server/src/CharacterControl.ts) method is called to set up the inventory for this particular user. 
   1. If the Characters shall be not permissioned, i.e. the clients can define whatever character they want, deactivate the UserController in [server-index](example/server/src/index.ts)
1. Then the Web-Client from `example/web-client` is shipped to the requesting connection
1. Client-Side startup procedure
   1. The [sendInitialUserUpdateToServer()](example/web-client/src/index.ts) method is called. Alongside the earlier generated `UserId`, which allows the server to identify this particular client, the client sends details on the User's character and username in the same `UserData` message. 
   1. The character is client-side defined in [CharacterRepository.ts](example/web-client/src/CharacterRepository.ts). Implement your logic here. 
   
1. The server receives the `UserData`-message. 
   1. For the (default) case, that a CharacterController is used, the CharacterDescription is verified and all non-permissible components are stripped from the character description.
   1. The authorized CharacterDescription, alongside other parameters such as the userName are sent in a `UserUpdate`-massge to all clients, including the client which has sent the `UserData` message.
   1. All connected clients react to this `UserUpdate` message and start rendering the user's character.

1. User-Updates
   1. In case a UserUpdate is sent from a client at a later time (e.g. after 5min playing the user decides he wants to use another wearable item), a new `UserData` message is sent, initiating a `UserUpdate` message as above. Eventual changes in CharacterDescription are applied on all clients.
   1. Note that the server can - at any time update UserData and distribute a `UserUpdate`-message. This is useful e.g. through admin changes, blockchain ownership changes, game-logic, ...
