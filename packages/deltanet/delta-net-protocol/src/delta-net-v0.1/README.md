# Delta Net Protocol v0.1

Delta Net is a real-time networking protocol designed for presence-based multiplayer games. It focuses on efficiently synchronizing game state between clients and server using delta encoding and varint encoding.

## Core Concepts

### Components
- Numeric values that change frequently (e.g., position coordinates)
- Each component has a unique ID
- Values are transmitted using delta compression (changes from previous state)
- Components are updated at regular intervals (ticks)

### States
- Binary values that change infrequently (e.g., usernames, serialized objects)
- Each state has a unique ID
- Transmitted only when they change
- Not included in regular tick updates
- Values are transmitted as Uint8Arrays for maximum flexibility

### User Indices
- Each user is assigned a unique index in the server's data array
- This index is used to track all user data
- Indices can be removed when users disconnect
- Client must defragment indices when removals occur

## Message Types

### Server to Client Messages

#### 1. Initial Checkout (Type 1)
Sent when a client first connects to establish initial state.

```typescript
{
  type: "initialCheckout";
  serverTime: number;        // Current server time
  indices: number;          // Number of user indices
  components: Array<{
    componentId: number;    // ID of the component
    deltaBytes: Uint8Array; // Delta values from the tick
    componentBytes: Uint8Array; // Initial values
  }>;
  states: Array<[number, Uint8Array]>; // [stateId, stateValue]
}
```

#### 2. Server Broadcast (Type 2)
General server announcements to all clients.

#### 3. User Index (Type 4)
Response to client connection, assigns an index to the user / connection.

#### 4. Tick (Type 6)
Regular state updates sent at configurable intervals (typically 5-20Hz).

```typescript
{
  type: "tick";
  serverTime: number;       // Current server time
  removedIndices: number[]; // Indices of disconnected users
  indicesCount: number;     // Current number of indices
  componentDeltaDeltas: Array<{
    componentId: number;
    componentDeltaDeltaBytes: Uint8Array; // Second-order deltas
  }>;
  states: Array<{
    stateId: number;
    states: Array<[number, Uint8Array]>; // [index, value]
  }>;
}
```

#### 5. Ping (Type 8)
Server heartbeat message to check client connectivity.

#### 6. Warning (Type 9)
Server warning messages for non-critical issues.

#### 7. Error (Type 10)
Server error messages for critical issues.

### Client to Server Messages

#### 1. Connect User (Type 11)
Initial connection request from client.

```typescript
{
  type: "connectUser";
  token: string;           // Authentication token
  observer: boolean;       // Whether client is observer-only
  components: Array<[number, number]>; // [componentId, value]
  states: Array<[number, Uint8Array]>; // [stateId, value]
}
```

#### 2. Set User Components (Type 12)
Client updates to component values.

```typescript
{
  type: "setUserComponents";
  components: Array<[number, number]>; // [componentId, value]
  states: Array<[number, Uint8Array]>; // [stateId, value]
}
```

#### 3. Set User State (Type 13)
Client updates to state values.

#### 4. Pong (Type 14)
Response to server ping messages.

## Data Encoding

### Varint Encoding
- Uses standard varint encoding for all numeric values
- Efficient for small numbers
- Variable length based on value size

### Delta Compression
- Components use double delta compression:
  1. First delta: difference from previous value
  2. Second delta: difference from previous delta
- This provides better compression for values that change predictably

### Message Format
Each message starts with a type byte, followed by:
- Length-prefixed fields using varints
- Binary data for components
- Length-prefixed binary data for states

## Protocol Flow

1. **Connection**
   - Client sends Connect User message with initial state
   - Server responds with User Index message
   - Server sends Initial Checkout message with full game state

2. **Regular Updates**
   - Server sends Tick messages at regular intervals
   - Clients can send component and state updates
   - Server broadcasts changes to all clients

3. **Connection Maintenance**
   - Server sends Ping messages
   - Clients respond with Pong messages
   - Server can send Warning or Error messages as needed

## Implementation Notes

- All numeric values use varint encoding for efficiency
- Component updates use double delta compression for better compression
- State updates are sent only when they change
- Clients must handle index defragmentation when users disconnect
- The protocol is designed for presence-based games
